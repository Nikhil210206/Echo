import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Optional, Set

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.errors import AppError
from app.models import User

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")
ALGORITHM = "HS256"

router = APIRouter(tags=["stream"])

# In-memory pub/sub subscribers
subscribers: Set[asyncio.Queue] = set()


def broadcast_event(event_type: str, data: Dict[str, Any]) -> None:
    """Pushes an SSE event payload to all connected subscriber queues. Safe to call from worker threads
    (sync endpoints run in one): asyncio queues aren't thread-safe, so the put is handed to their loop."""
    payload = {
        "type": event_type,
        "at": datetime.now(timezone.utc).isoformat(),
        **data,
    }
    if _loop is None:
        return
    for q in list(subscribers):
        try:
            _loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass


# The event loop the SSE generators run on, captured when the first client connects
_loop: Optional[asyncio.AbstractEventLoop] = None


async def sse_event_generator(q: asyncio.Queue) -> AsyncGenerator[str, None]:
    """Yields SSE formatted string messages and periodic heartbeats."""
    global _loop
    _loop = asyncio.get_running_loop()
    subscribers.add(q)
    try:
        while True:
            try:
                payload = await asyncio.wait_for(q.get(), timeout=15.0)
                # jsonable_encoder: payloads carry datetimes, which json.dumps rejects (and that killed the stream)
                yield f"data: {json.dumps(jsonable_encoder(payload))}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        subscribers.discard(q)


def _lookup_role(user_id: str) -> Optional[str]:
    db = SessionLocal()
    try:
        role = db.query(User.role).filter(User.id == user_id).scalar()
        if role is None:
            return None
        return role.value if hasattr(role, "value") else str(role)
    finally:
        db.close()


@router.get("/stream")
async def stream_events(
    token: Optional[str] = Query(None),
) -> StreamingResponse:
    """SSE endpoint for streaming real-time system events to admin clients."""
    if not token:
        raise AppError("UNAUTHORIZED", "Missing authentication token", status_code=401)

    if not JWT_SECRET:
        raise AppError("INTERNAL_ERROR", "JWT secret configuration missing", status_code=500)

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise AppError("UNAUTHORIZED", "Invalid token payload", status_code=401)
    except JWTError:
        raise AppError("UNAUTHORIZED", "Invalid or expired access token", status_code=401)

    # In a thread: a blocking query in this async handler would stall every other request meanwhile
    user_role_str = await asyncio.to_thread(_lookup_role, user_id)
    if user_role_str is None:
        raise AppError("UNAUTHORIZED", "User not found", status_code=401)
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required to connect to stream", status_code=403)

    q: asyncio.Queue = asyncio.Queue()
    return StreamingResponse(
        sse_event_generator(q),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
