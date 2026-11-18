"""Exercise the stream authentication contract with synthetic credentials."""
import logging
import os
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///unused-test.db")
os.environ.setdefault("JWT_SECRET", "test-secret")

from app.auth import create_access_token
from app.main import app
from app.models import User, UserRole


@pytest.fixture
def stream(monkeypatch):
    monkeypatch.setattr("app.routers.stream._lookup_role", lambda user_id: {"local-admin": "admin", "local-staff": "staff"}.get(user_id))

    async def fixture_events(_):
        yield 'data: {"type":"feedback"}\n\n'

    monkeypatch.setattr("app.routers.stream.sse_event_generator", fixture_events)
    return TestClient(app)


def _token(user_id: str, role: UserRole, expires_delta=None):
    user = User(id=user_id, name="Synthetic fixture", role=role)
    return create_access_token(user, expires_delta=expires_delta)


def test_stream_only_accepts_bearer_header_and_current_admin_role(stream):
    admin = _token("local-admin", UserRole.admin)
    assert stream.get("/api/stream").status_code == 401
    assert stream.get("/api/stream", params={"token": admin}).status_code == 401
    assert stream.get("/api/stream", headers={"Authorization": "Bearer invalid"}).status_code == 401
    expired = _token("local-admin", UserRole.admin, timedelta(seconds=-1))
    assert stream.get("/api/stream", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    # A token claiming admin still gets the current DB role.
    staff = _token("local-staff", UserRole.admin)
    assert stream.get("/api/stream", headers={"Authorization": f"Bearer {staff}"}).status_code == 403

    response = stream.get("/api/stream", headers={"Authorization": f"Bearer {admin}"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text == 'data: {"type":"feedback"}\n\n'
    assert response.request.url.query == b""


def test_stream_access_log_scrubs_legacy_query(caplog):
    url = "/api/stream?token=synthetic-token-marker&other=marker"
    logger = logging.getLogger("uvicorn.access")
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:123", "GET", url, "1.1", 401)
    assert '"GET /api/stream HTTP/1.1" 401' in caplog.text
    assert "synthetic-token-marker" not in caplog.text and "other=marker" not in caplog.text
