import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, List

from dotenv import load_dotenv
from fastapi import Request
from sqlalchemy import create_engine, event, exc
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# Load environment variables from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set in .env file.")

# Every round trip to a remote Postgres (Neon) costs ~100-350 ms, so this module avoids the hidden ones:
# no ping on every checkout (see below), and no BEGIN/ROLLBACK for read-only requests.
engine = create_engine(
    DATABASE_URL,
    pool_recycle=1800,
    pool_size=20,
    max_overflow=10,
)

# Only ping connections that sat idle long enough to have been dropped, instead of pool_pre_ping on every checkout
IDLE_PING_AFTER_SECONDS = 120


@event.listens_for(engine, "checkin")
def _mark_idle(dbapi_connection, connection_record):
    connection_record.info["idle_since"] = time.monotonic()


@event.listens_for(engine, "checkout")
def _ping_if_idle(dbapi_connection, connection_record, connection_proxy):
    idle_since = connection_record.info.get("idle_since")
    if idle_since is None or time.monotonic() - idle_since < IDLE_PING_AFTER_SECONDS:
        return
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        dbapi_connection.rollback()
    except Exception:
        # Tells the pool to discard this connection and retry with a fresh one
        raise exc.DisconnectionError()


# Autocommit view of the same pool for requests that only read: skips the BEGIN/ROLLBACK round trips
read_engine = engine.execution_options(isolation_level="AUTOCOMMIT")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
ReadSessionLocal = sessionmaker(autoflush=False, bind=read_engine)

Base = declarative_base()


def get_db(request: Request):
    """FastAPI dependency that yields a SQLAlchemy database session and ensures it closes after use.
    GET requests never write, so they get an autocommit session."""
    db = ReadSessionLocal() if request.method == "GET" else SessionLocal()
    try:
        yield db
    finally:
        db.close()


_parallel_pool = ThreadPoolExecutor(max_workers=12)


def run_parallel(*tasks: Callable[[Session], Any]) -> List[Any]:
    """Runs independent read-only queries concurrently, each on its own session, so a page pays
    for one database round trip at a time instead of the sum of all of them."""

    def run(task):
        db = ReadSessionLocal()
        try:
            return task(db)
        finally:
            db.close()

    return [f.result() for f in [_parallel_pool.submit(run, t) for t in tasks]]
