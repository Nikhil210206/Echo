import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure all SQLAlchemy models are registered
import app.models  # noqa: F401

from app.auth import router as auth_router
from app.errors import register_error_handlers
from app.routers.admin import router as admin_router
from app.routers.ask import router as ask_router
from app.routers.issues import router as issues_router
from app.routers.public import router as public_router
from app.routers.stream import router as stream_router

import asyncio
from app.db import SessionLocal
from sqlalchemy import text

# Load environment variables
load_dotenv()

app = FastAPI(
    title="Echo API",
    description="Backend API for Echo Campus Feedback & Issue Resolution Platform",
    version="1.0.0",
)


async def db_keep_alive_task():
    """Background loop sending periodic keep-alive pings to keep Neon Postgres pool warm."""
    while True:
        try:
            await asyncio.sleep(15)
            db = SessionLocal()
            try:
                db.execute(text("SELECT 1"))
            finally:
                db.close()
        except Exception:
            pass


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(db_keep_alive_task())


# Register structured exception handlers
register_error_handlers(app)

# CORS setup
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5180")
cors_origins_env = os.getenv("CORS_ORIGINS", "")
extra_origins = [url.strip() for url in cors_origins_env.split(",") if url.strip()]

origins = list(set(["http://localhost:5180", frontend_url] + extra_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/")
def health_check():
    """Simple root health check endpoint."""
    return {"status": "ok"}


# Include routers with /api prefix
app.include_router(auth_router, prefix="/api")
app.include_router(public_router, prefix="/api")
app.include_router(issues_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(stream_router, prefix="/api")
app.include_router(ask_router)
