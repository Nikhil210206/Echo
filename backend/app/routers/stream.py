import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Optional, Set

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Query
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
    """Pushes an SSE event payload to all connected subscriber queues."""
    payload = {
        "type": event_type,
        "at": datetime.now(timezone.utc).isoformat(),
        **data,
    }
    for q in list(subscribers):
        try:
            q.put_nowait(payload)
        except Exception:
            pass


async def sse_event_generator(q: asyncio.Queue) -> AsyncGenerator[str, None]:
    """Yields SSE formatted string messages and periodic heartbeats."""
    subscribers.add(q)
    try:
        while True:
            try:
                payload = await asyncio.wait_for(q.get(), timeout=15.0)
                yield f"data: {json.dumps(payload)}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        subscribers.discard(q)


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

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise AppError("UNAUTHORIZED", "User not found", status_code=401)

        user_role_str = (
            user.role.value if hasattr(user.role, "value") else str(user.role)
        )
        if user_role_str != "admin":
            raise AppError("FORBIDDEN", "Admin access required to connect to stream", status_code=403)
    finally:
        db.close()

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
