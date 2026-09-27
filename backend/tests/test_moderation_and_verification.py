"""API tests for spam handling (flagged feedback stays out of issues until approved) and fix verification.

Runs against a throwaway in-memory SQLite database via dependency overrides, so it never touches the
database in .env. The LLM pipeline and clustering are stubbed for deterministic results.
"""
import os

# Placeholder so app.db imports; every test session comes from the override below
os.environ.setdefault("DATABASE_URL", "sqlite:///unused-test.db")
os.environ.setdefault("JWT_SECRET", "test-secret")

from datetime import datetime, timedelta, timezone  # noqa: E402
from unittest.mock import patch  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Aspect,
    Feedback,
    FeedbackKind,
    FeedbackStatus,
    Issue,
    IssueStatus,
    Location,
    User,
    UserRole,
    Verification,
)
from app.schemas import AnalysisPipelineResult, AspectResult, ModerationFlags  # noqa: E402
from app.services.cluster import ClusterMatchResult  # noqa: E402

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False)

    db = TestSession()
    loc = Location(name="Central Mess", slug="central-mess")
    admin = User(name="Admin", email="a@x.test", password_hash="x", role=UserRole.admin)
    db.add_all([loc, admin])
    db.commit()

    def override_db():
        s = TestSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: admin
    # Every complaint opens its own new issue; no embedding model needed
    no_match = ClusterMatchResult(should_join=False, embedding=[0.0] * 3)
    with patch("app.services.lifecycle.cluster_aspect", return_value=no_match):
        yield TestClient(app), db, loc
    app.dependency_overrides.clear()
    db.close()


def analysis(flagged: bool) -> AnalysisPipelineResult:
    text = "The mess food made me sick again today"
    return AnalysisPipelineResult(
        raw_text=text,
        text_redacted=text,
        aspects=[
            AspectResult(aspect="food", category="mess", sentiment="negative", urgency="high", evidence_span=text)
        ],
        overall_sentiment="negative",
        analyzed_by="lexicon",
        moderation=ModerationFlags(flagged=flagged, is_spam=flagged, masked_text=text),
    )


def submit(client, flagged: bool) -> str:
    with patch("app.routers.public.run_analysis_pipeline", return_value=analysis(flagged)):
        r = client.post("/api/feedback", json={"text": "The mess food made me sick again today", "location_slug": "central-mess"})
    assert r.status_code == 200, r.text
    return r.json()["tracking_code"]


def feedback_by_code(db, code) -> Feedback:
    db.expire_all()
    return db.query(Feedback).filter(Feedback.tracking_code == code).one()


# --- Spam / moderation ---


def test_flagged_feedback_creates_no_issue(env):
    client, db, _ = env
    fb = feedback_by_code(db, submit(client, flagged=True))
    assert fb.status == FeedbackStatus.pending
    assert all(a.issue_id is None for a in fb.aspects)
    assert db.query(Issue).count() == 0


def test_approved_feedback_still_creates_issue(env):
    client, db, _ = env
    fb = feedback_by_code(db, submit(client, flagged=False))
    assert fb.status == FeedbackStatus.approved
    assert fb.aspects[0].issue_id is not None
    assert db.query(Issue).one().priority_score > 0


def test_approving_flagged_feedback_links_it(env):
    client, db, _ = env
    code = submit(client, flagged=True)
    r = client.patch(f"/api/feedback/{feedback_by_code(db, code).id}/moderation", json={"action": "approve"})
    assert r.status_code == 200
    fb = feedback_by_code(db, code)
    issue = db.query(Issue).one()
    assert fb.aspects[0].issue_id == issue.id
    assert issue.priority_score > 0


def test_redacting_flagged_feedback_links_it(env):
    client, db, _ = env
    code = submit(client, flagged=True)
    r = client.patch(
        f"/api/feedback/{feedback_by_code(db, code).id}/moderation", json={"action": "redact", "text": "Mess food was bad"}
    )
    assert r.status_code == 200
    assert feedback_by_code(db, code).aspects[0].issue_id is not None


def test_rejecting_flagged_feedback_keeps_it_out(env):
    client, db, _ = env
    code = submit(client, flagged=True)
    client.patch(f"/api/feedback/{feedback_by_code(db, code).id}/moderation", json={"action": "reject"})
    assert feedback_by_code(db, code).aspects[0].issue_id is None
    assert db.query(Issue).count() == 0


def test_rejecting_approved_feedback_removes_its_reports(env):
    client, db, _ = env
    code = submit(client, flagged=False)
    issue_id = feedback_by_code(db, code).aspects[0].issue_id
    client.patch(f"/api/feedback/{feedback_by_code(db, code).id}/moderation", json={"action": "reject"})
    db.expire_all()
    assert feedback_by_code(db, code).aspects[0].issue_id is None
    assert db.query(Aspect).filter(Aspect.issue_id == issue_id).count() == 0
    assert db.get(Issue, issue_id).priority_score == 0


# --- Fix verification ---


def make_resolved_issue(db, loc, resolved_at=None) -> Issue:
    issue = Issue(
        title="Mess food",
        category="mess",
        location_id=loc.id,
        status=IssueStatus.resolved,
        public_response="New cook hired",
        resolved_at=resolved_at or NOW - timedelta(days=1),
        created_at=NOW - timedelta(days=5),
    )
    db.add(issue)
    db.commit()
    return issue


def add_report(db, loc, issue, code, created_at=None, linked=True) -> Feedback:
    fb = Feedback(
        kind=FeedbackKind.me_too,
        location_id=loc.id,
        tracking_code=code,
        status=FeedbackStatus.approved,
        created_at=created_at or NOW - timedelta(days=3),
    )
    db.add(fb)
    db.flush()
    db.add(
        Aspect(
            feedback_id=fb.id,
            aspect="me_too",
            category="mess",
            sentiment="negative",
            urgency="normal",
            issue_id=issue.id if linked else None,
        )
    )
    db.commit()
    return fb


def vote(client, code, issue, fixed):
    return client.post(f"/api/track/{code}/verify", json={"issue_id": issue.id, "fixed": fixed})


def test_cannot_verify_unresolved_issue(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    issue.status = IssueStatus.in_progress
    db.commit()
    add_report(db, loc, issue, "AAAA1111")
    r = vote(client, "AAAA1111", issue, False)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_RESOLVED"


def test_cannot_verify_issue_you_did_not_report(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    add_report(db, loc, issue, "AAAA1111", linked=False)
    r = vote(client, "AAAA1111", issue, False)
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_LINKED"


def test_reports_made_after_the_fix_cannot_vote(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    add_report(db, loc, issue, "AAAA1111", created_at=NOW - timedelta(hours=1))
    r = vote(client, "AAAA1111", issue, False)
    assert r.status_code == 403 and r.json()["error"]["code"] == "REPORTED_AFTER_FIX"
    assert client.get("/api/track/AAAA1111").json()["issues"][0]["can_verify"] is False


def test_prefixed_code_cannot_vote_twice(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    add_report(db, loc, issue, "AAAA1111")
    assert vote(client, "ECH-AAAA1111", issue, True).status_code == 200
    r = vote(client, "AAAA1111", issue, True)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ALREADY_VOTED"
    # Stored under the real code, so the track page shows the vote
    assert db.query(Verification).one().tracking_code == "AAAA1111"
    assert client.get("/api/track/AAAA1111").json()["issues"][0]["my_vote"] is True


def test_reopens_once_then_rejects_further_votes(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    for code in ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444"]:
        add_report(db, loc, issue, code)

    assert vote(client, "AAAA1111", issue, True).status_code == 200
    assert vote(client, "BBBB2222", issue, False).status_code == 200
    assert vote(client, "CCCC3333", issue, True).status_code == 200  # 1 of 3 not fixed: 33% >= 30%

    db.expire_all()
    issue = db.get(Issue, issue.id)
    assert issue.status == IssueStatus.reopened
    assert issue.reopened_count == 1

    r = vote(client, "DDDD4444", issue, False)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_RESOLVED"
    db.expire_all()
    assert db.get(Issue, issue.id).reopened_count == 1


def test_resolving_again_starts_a_new_vote(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc, resolved_at=NOW - timedelta(days=2))
    add_report(db, loc, issue, "AAAA1111")
    db.add(Verification(issue_id=issue.id, tracking_code="AAAA1111", fixed=False, created_at=NOW - timedelta(days=1)))
    db.commit()

    # Re-fixed after that vote: the old "not fixed" no longer counts and the reporter can check again
    issue.resolved_at = NOW - timedelta(hours=1)
    db.commit()
    tracked = client.get("/api/track/AAAA1111").json()["issues"][0]
    assert tracked["can_verify"] is True and tracked["my_vote"] is None
    assert vote(client, "AAAA1111", issue, True).status_code == 200


# --- Priority consistency ---


def test_issue_page_score_matches_breakdown_and_me_too_rescores(env):
    client, db, loc = env
    issue_id = feedback_by_code(db, submit(client, flagged=False)).aspects[0].issue_id

    with patch("app.routers.issues.run_parallel", side_effect=lambda *tasks: [t(db) for t in tasks]):
        detail = client.get(f"/api/issues/{issue_id}").json()
    assert detail["priority_score"] == detail["breakdown"]["score"] == 2.0  # 1 recent report × 100% × high

    assert client.post(f"/api/issues/{issue_id}/metoo", json={"device_id": "phone-1"}).status_code == 200
    db.expire_all()
    stored = db.get(Issue, issue_id).priority_score
    with patch("app.routers.issues.run_parallel", side_effect=lambda *tasks: [t(db) for t in tasks]):
        detail = client.get(f"/api/issues/{issue_id}").json()
    assert stored == detail["priority_score"] == detail["breakdown"]["score"] == 4.0  # 2 reports × 100% × high


def test_rescore_all_decays_old_reports(env):
    from app.services.lifecycle import rescore_all_issues

    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    issue.priority_score = 99.0
    add_report(db, loc, issue, "AAAA1111", created_at=NOW - timedelta(days=10))
    rescore_all_issues(db)
    db.commit()
    assert db.get(Issue, issue.id).priority_score == 0.5  # one report older than a week counts half


# --- Bad input returns 4xx, not 500 ---


@pytest.mark.parametrize(
    "path",
    [
        "/api/issues?status=bogus",
        "/api/users?role=bogus",
        "/api/feedback?status=bogus",
        "/api/feedback?days=99999999",
        "/api/analytics/summary?days=99999999",
    ],
)
def test_bad_filters_are_rejected_cleanly(env, path):
    client, _, _ = env
    r = client.get(path)
    assert 400 <= r.status_code < 500, (path, r.status_code, r.text)


def test_assigning_unknown_user_is_rejected_and_null_unassigns(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    staff = User(name="Staff", email="s@x.test", password_hash="x", role=UserRole.staff)
    db.add(staff)
    issue.assignee_id = None
    db.commit()
    no_parallel = patch("app.routers.issues.run_parallel", side_effect=lambda *tasks: [t(db) for t in tasks])

    r = client.patch(f"/api/issues/{issue.id}", json={"assignee_id": "no-such-user"})
    assert r.status_code == 400 and r.json()["error"]["fields"] == {"assignee_id": "not_found"}

    with no_parallel:
        assert client.patch(f"/api/issues/{issue.id}", json={"assignee_id": staff.id}).status_code == 200
    db.expire_all()
    assert db.get(Issue, issue.id).assignee_id == staff.id

    with no_parallel:
        assert client.patch(f"/api/issues/{issue.id}", json={"assignee_id": None}).status_code == 200
    db.expire_all()
    assert db.get(Issue, issue.id).assignee_id is None


def test_setting_the_same_status_logs_nothing(env):
    from app.models import IssueEvent

    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    resolved_at = db.get(Issue, issue.id).resolved_at
    with patch("app.routers.issues.run_parallel", side_effect=lambda *tasks: [t(db) for t in tasks]):
        assert client.patch(f"/api/issues/{issue.id}", json={"status": "resolved"}).status_code == 200
    db.expire_all()
    assert db.query(IssueEvent).count() == 0
    assert db.get(Issue, issue.id).resolved_at == resolved_at  # the verification round isn't reset


def test_unexpected_errors_return_json_with_cors(env):
    client, db, loc = env
    issue = make_resolved_issue(db, loc)
    add_report(db, loc, issue, "AAAA1111")
    with patch("app.routers.public.build_track_response", side_effect=RuntimeError("boom")):
        r = client.get("/api/track/AAAA1111", headers={"Origin": "http://localhost:5180"})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL_ERROR"
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5180"


# --- Landing page ticker ---


def test_ticker_shows_only_clean_approved_quotes(env):
    client, db, loc = env

    def fb(code, text, status=FeedbackStatus.approved, flags=None, sentiment="negative", minutes_ago=1):
        db.add(Feedback(kind=FeedbackKind.text, location_id=loc.id, tracking_code=code, status=status,
                        text_redacted=text, overall_sentiment=sentiment, flags=flags or [],
                        created_at=NOW - timedelta(minutes=minutes_ago)))

    fb("A1", "Mess food was cold today.", minutes_ago=1)
    fb("A2", "Library staff were lovely", sentiment="positive", minutes_ago=2)
    fb("B1", "Spammy click here", status=FeedbackStatus.pending, flags=["spam"])
    fb("B2", "Rejected thing", status=FeedbackStatus.rejected)
    fb("B3", "Mess food is f*** cold", flags=["profanity_masked"])
    fb("B4", "Nothing much to say", sentiment="neutral")
    fb("C1", "word " * 60, minutes_ago=3)
    db.commit()

    ticker = client.get("/api/public/ticker").json()
    assert [t["text"] for t in ticker[:2]] == ["Mess food was cold today", "Library staff were lovely"]
    assert len(ticker) == 3
    assert len(ticker[2]["text"]) <= 120 and ticker[2]["text"].endswith("…")
