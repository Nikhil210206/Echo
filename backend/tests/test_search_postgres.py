"""Opt-in PostgreSQL checks on a disposable database already migrated to head."""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, event, insert, select, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

os.environ.setdefault("DATABASE_URL", "sqlite:///unused-test.db")

from app.models import Aspect, Feedback, FeedbackKind, FeedbackStatus, Issue, Location, User, UserRole
from app.services.feedback_index import MODEL_VERSION, text_digest
from app.services.retrieval import Access, SearchFilters, feedback_detail, issue_details, search_records


@pytest.fixture()
def pg():
    url = os.getenv("ECHO_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set ECHO_TEST_POSTGRES_URL to a dedicated, migrated PostgreSQL test database")
    engine = create_engine(url, poolclass=NullPool, connect_args={"prepare_threshold": None})
    assert engine.dialect.name == "postgresql"
    try:
        with Session(engine) as db:
            yield db
            db.rollback()
    finally:
        engine.dispose()


def test_pgvector_ranking_and_database_invalidation(pg, monkeypatch):
    original = "The wireless network keeps disconnecting."
    unrelated = "Dinner was delicious."
    key = uuid4().hex
    vectors = [[1.0, 0.0] + [0.0] * 382, [0.0, 1.0] + [0.0] * 382]
    monkeypatch.setattr("app.services.retrieval.embed_with_timeout", lambda *args, **kwargs: vectors[0])
    pg.execute(insert(Location).values(id=key, slug=key, name="Test Library"))
    for i, excerpt in enumerate((original, unrelated)):
        pg.execute(insert(Feedback).values(
            id=f"{key}-{i}", location_id=key, tracking_code=f"{key}-{i}", kind=FeedbackKind.text,
            status=FeedbackStatus.approved, text_redacted=excerpt, search_embedding=vectors[i],
            search_embedding_key=f"{MODEL_VERSION}:{text_digest(excerpt)}",
        ))

    first, second = f"{key}-0", f"{key}-1"

    def hits():
        return search_records(pg, Access("test-admin", UserRole.admin), "Wi-Fi issues", SearchFilters(location=key))

    assert [(row.id, row.similarity) for row in hits()] == [(first, 1.0), (second, 0.0)]
    admin = Access("test-admin", UserRole.admin)
    assert feedback_detail(pg, admin, first)["text"] == original
    assert [row.id for row in search_records(pg, admin, "wireless network", SearchFilters(location=key),
                                             semantic=False)] == [first]
    pg.execute(update(Feedback).where(Feedback.id == first).values(text_redacted="Edited at the source."))
    assert [row.id for row in hits()] == [second]
    assert pg.scalar(select(Feedback.search_embedding).where(Feedback.id == first)) is None
    pg.execute(update(Feedback).where(Feedback.id == second).values(status=FeedbackStatus.rejected))
    assert hits() == []
    assert pg.scalar(select(Feedback.search_embedding_key).where(Feedback.id == second)) is None

    pg.execute(update(Feedback).where(Feedback.id == first).values(
        status=FeedbackStatus.approved, text_redacted=original, search_embedding=vectors[0],
        search_embedding_key=f"{MODEL_VERSION}:{text_digest(original)}",
    ))
    assert [row.id for row in hits()] == [first]
    pg.execute(delete(Feedback).where(Feedback.id == first))
    assert hits() == []


def test_issue_summary_uses_bounded_sql_results_on_many_aspects(pg):
    key = uuid4().hex
    now = datetime.now(timezone.utc)
    pg.execute(insert(Location).values(id=key, slug=key, name="Test Hall"))
    pg.execute(insert(User).values(
        id=key, email=f"{key}@test.invalid", name="Assigned Staff", password_hash="unused", role=UserRole.staff,
    ))
    pg.execute(insert(Issue).values(
        id=key, location_id=key, title="Large issue", category="infrastructure", assignee_id=key, status="open",
    ))
    feedback_rows = [
        {"id": key + "-recent", "created_at": now, "status": "approved"},
        {"id": key + "-older", "created_at": now - timedelta(days=10), "status": "approved"},
        {"id": key + "-rejected", "created_at": now, "status": "rejected"},
    ]
    pg.execute(insert(Feedback), [
        {**row, "location_id": key, "tracking_code": row["id"], "kind": "text"} for row in feedback_rows
    ])
    base = {"issue_id": key, "aspect": "wifi", "category": "infrastructure"}
    pg.execute(insert(Aspect), [
        {**base, "feedback_id": key + "-recent", "sentiment": "neutral", "urgency": "normal"} for _ in range(1500)
    ] + [
        {**base, "feedback_id": key + "-recent", "sentiment": "negative", "urgency": "high"},
        {**base, "feedback_id": key + "-older", "sentiment": "positive", "urgency": "CRITICAL"},
        {**base, "feedback_id": key + "-rejected", "sentiment": "negative", "urgency": "critical"},
    ])

    queries = []
    connection = pg.connection()

    def capture(conn, cursor, statement, parameters, context, executemany):
        queries.append((statement.lower(), cursor.rowcount))

    event.listen(connection, "after_cursor_execute", capture)
    try:
        record = issue_details(pg, Access(key, UserRole.staff), key)
        assert record["report_count"] == 2
        assert record["priority"] == {
            "recent_reports": 1, "older_reports": 1, "recency_weighted": 1.5,
            "negative_share": 0.5, "urgency_multiplier": 3, "score": 2.25,
        }
        assert [row_count for _, row_count in queries] == [1, 1]
        assert "limit" in queries[0][0] and "group by" in queries[1][0]
        assert all("text_redacted" not in statement and "evidence_span" not in statement for statement, _ in queries)
        queries.clear()
        assert issue_details(pg, Access("other-staff", UserRole.staff), key) is None
        assert [row_count for _, row_count in queries] == [0]
    finally:
        event.remove(connection, "after_cursor_execute", capture)
