from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.auth import get_current_user
from app.db import get_db, run_parallel
from app.errors import AppError
from app.models import (
    Aspect,
    Feedback,
    FeedbackStatus,
    Issue,
    Location,
    User,
    UserRole,
)
from app.routers.stream import broadcast_event
from app.services.lifecycle import link_negative_aspects, rescore_issues, unlink_feedback

router = APIRouter(tags=["admin"])

# Longest look-back a "days" filter accepts; far larger values overflow date arithmetic
MAX_DAYS = 3650


# --- Pydantic Schemas ---
class ModerationActionRequest(BaseModel):
    action: str  # "approve" | "reject" | "redact"
    text: Optional[str] = None


# --- Helper Functions ---
def format_feedback_record(fb: Feedback) -> Dict[str, Any]:
    """Formats a Feedback ORM instance into the standardized FeedbackRecord dict."""
    loc_name = fb.location.name if fb.location else "Unknown"
    status_str = fb.status.value if hasattr(fb.status, "value") else str(fb.status)

    aspects_list = [
        {
            "id": a.id,
            "aspect": a.aspect,
            "category": a.category,
            "sentiment": a.sentiment,
            "urgency": a.urgency,
            "evidence_span": a.evidence_span,
            "issue_id": a.issue_id,
        }
        for a in fb.aspects
    ]

    return {
        "id": fb.id,
        "text_redacted": fb.text_redacted,
        "location_name": loc_name,
        "tracking_code": fb.tracking_code,
        "status": status_str,
        "overall_sentiment": fb.overall_sentiment,
        "analyzed_by": fb.analyzed_by,
        "flags": fb.flags or [],
        "created_at": fb.created_at,
        "aspects": aspects_list,
    }


# --- Endpoints ---


@router.get("/feedback")
def search_feedback(
    q: Optional[str] = None,
    sentiment: Optional[str] = None,
    category: Optional[str] = None,
    location_id: Optional[str] = None,
    days: Optional[int] = Query(None, le=MAX_DAYS),
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Search feedback with filters and pagination."""
    query = db.query(Feedback).options(
        joinedload(Feedback.location),
        joinedload(Feedback.aspects).defer(Aspect.embedding),
    )

    # Default status to 'approved' if not explicitly provided
    filter_status = status if status is not None else "approved"
    if filter_status and filter_status not in {st.value for st in FeedbackStatus}:
        raise AppError("VALIDATION_ERROR", f"Unknown status '{filter_status}'", status_code=400, fields={"status": "invalid"})
    if filter_status:
        query = query.filter(Feedback.status == filter_status)

    if q:
        query = query.filter(Feedback.text_redacted.ilike(f"%{q}%"))

    if location_id:
        query = query.filter(Feedback.location_id == location_id)

    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(Feedback.created_at >= cutoff)

    # IN-subquery instead of JOIN + DISTINCT: Postgres can't DISTINCT over the json `flags` column
    if sentiment or category:
        matching = db.query(Aspect.feedback_id)
        if sentiment:
            matching = matching.filter(Aspect.sentiment == sentiment)
        if category:
            matching = matching.filter(Aspect.category == category)
        query = query.filter(Feedback.id.in_(matching))

    total = query.count()
    offset = (page - 1) * page_size
    items = query.order_by(Feedback.created_at.desc()).offset(offset).limit(page_size).all()

    return {
        "items": [format_feedback_record(fb) for fb in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/moderation/queue")
def get_moderation_queue(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return all pending feedback for moderation (Admin only)."""
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    pending_items = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.location),
            joinedload(Feedback.aspects).defer(Aspect.embedding),
        )
        .filter(Feedback.status == FeedbackStatus.pending)
        .order_by(Feedback.created_at.asc())
        .all()
    )

    return [format_feedback_record(fb) for fb in pending_items]


@router.patch("/feedback/{id}/moderation")
def moderate_feedback(
    id: str,
    payload: ModerationActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Moderate feedback by approving, rejecting, or redacting (Admin only)."""
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    fb = db.query(Feedback).filter(Feedback.id == id).first()
    if not fb:
        raise AppError("NOT_FOUND", f"Feedback with id '{id}' not found", status_code=404)

    if payload.action == "approve":
        fb.status = FeedbackStatus.approved
    elif payload.action == "reject":
        fb.status = FeedbackStatus.rejected
    elif payload.action == "redact":
        if not payload.text or not payload.text.strip():
            raise AppError("VALIDATION_ERROR", "text required for redact action", status_code=400)

        new_text = payload.text.strip()
        if fb.text_redacted != new_text:
            flags = list(fb.flags or [])
            if "profanity_masked" not in flags:
                flags.append("profanity_masked")
            fb.flags = flags

        fb.text_redacted = new_text
        fb.status = FeedbackStatus.approved
    else:
        raise AppError(
            "VALIDATION_ERROR",
            f"Invalid moderation action '{payload.action}'",
            status_code=400,
        )

    # Only approved feedback counts toward issues: approving links its complaints into issues,
    # rejecting takes it back out of any issue it was part of
    if fb.status == FeedbackStatus.approved:
        rescore_issues(db, link_negative_aspects(db, fb.aspects, fb.location_id))
    elif fb.status == FeedbackStatus.rejected:
        rescore_issues(db, unlink_feedback(db, fb))

    db.commit()
    db.refresh(fb)

    record = format_feedback_record(fb)
    broadcast_event("moderation", {"feedback": record})
    return record


def _require_admin(current_user: User) -> None:
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)


# The analytics, alerts and dashboard endpoints are built from small independent queries that do their
# counting in SQL. Each is a task taking its own session, so they run in parallel (see run_parallel):
# against a remote database the page then costs roughly one round trip instead of one per query.


def _run_tasks(tasks: Dict[str, Callable[[Session], Any]]) -> Dict[str, Any]:
    return dict(zip(tasks.keys(), run_parallel(*tasks.values())))


def _analytics_tasks(days: int) -> Dict[str, Callable[[Session], Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    sentiment = func.lower(func.coalesce(Feedback.overall_sentiment, "neutral"))
    aspect_sentiment = func.lower(func.coalesce(Aspect.sentiment, "neutral"))
    category = func.coalesce(func.nullif(Aspect.category, ""), "general")

    return {
        "sentiment_rows": lambda db: db.query(func.date(Feedback.created_at), sentiment, func.count(Feedback.id))
        .filter(Feedback.created_at >= cutoff)
        .group_by(func.date(Feedback.created_at), sentiment)
        .all(),
        "topic_rows": lambda db: db.query(category, aspect_sentiment, func.count(Aspect.id))
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Feedback.created_at >= cutoff)
        .group_by(category, aspect_sentiment)
        .all(),
        "locations": lambda db: db.query(Location.id, Location.name).all(),
        "categories": lambda db: [c for (c,) in db.query(Aspect.category).distinct().all() if c],
        "heatmap_rows": lambda db: db.query(Feedback.location_id, Aspect.category, func.count(Aspect.id))
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= cutoff)
        .group_by(Feedback.location_id, Aspect.category)
        .all(),
        "status_rows": lambda db: db.query(Issue.status, func.count(Issue.id)).group_by(Issue.status).all(),
        "avg_resolve_seconds": lambda db: db.query(func.avg(func.extract("epoch", Issue.resolved_at - Issue.created_at)))
        .filter(Issue.resolved_at.isnot(None), Issue.created_at.isnot(None))
        .scalar(),
        "feedback_count": lambda db: db.query(func.count(Feedback.id)).scalar() or 0,
    }


def _assemble_analytics(days: int, r: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)

    # 1. sentiment_over_time
    start_date = (now - timedelta(days=days)).date()
    end_date = now.date()

    date_map: Dict[str, Dict[str, Any]] = {}
    curr_d = start_date
    while curr_d <= end_date:
        d_str = curr_d.strftime("%Y-%m-%d")
        date_map[d_str] = {"date": d_str, "positive": 0, "neutral": 0, "negative": 0}
        curr_d += timedelta(days=1)

    for day, sent, count in r["sentiment_rows"]:
        d_str = day.strftime("%Y-%m-%d")
        if d_str in date_map:
            key = sent if sent in ("positive", "negative") else "neutral"
            date_map[d_str][key] += count

    # 2. topic_sentiment
    topic_map: Dict[str, Dict[str, Any]] = {}
    for cat, sent, count in r["topic_rows"]:
        entry = topic_map.setdefault(cat, {"category": cat, "positive": 0, "negative": 0})
        if sent in ("positive", "negative"):
            entry[sent] += count

    # 3. heatmap
    loc_names = [name for _, name in r["locations"]]
    loc_index_map = {loc_id: idx for idx, (loc_id, _) in enumerate(r["locations"])}
    cat_names = sorted(set(r["categories"])) or ["general", "infrastructure", "hostel", "mess"]
    cat_index_map = {cat_name: idx for idx, cat_name in enumerate(cat_names)}

    values_matrix = [[0 for _ in cat_names] for _ in loc_names]
    for loc_id, cat, count in r["heatmap_rows"]:
        if loc_id in loc_index_map and cat in cat_index_map:
            values_matrix[loc_index_map[loc_id]][cat_index_map[cat]] += count

    # 4. pipeline
    pipeline_counts = {"open": 0, "acknowledged": 0, "in_progress": 0, "resolved": 0, "reopened": 0}
    for status, count in r["status_rows"]:
        status_str = status.value if hasattr(status, "value") else str(status)
        if status_str in pipeline_counts:
            pipeline_counts[status_str] += count

    avg_seconds = r["avg_resolve_seconds"]
    avg_days_to_resolve = round(float(avg_seconds) / 86400.0, 2) if avg_seconds is not None else 0.0

    return {
        "sentiment_over_time": list(date_map.values()),
        "topic_sentiment": list(topic_map.values()),
        "heatmap": {"locations": loc_names, "categories": cat_names, "values": values_matrix},
        "pipeline": [{"status": s, "count": c} for s, c in pipeline_counts.items()],
        "avg_days_to_resolve": avg_days_to_resolve,
        "totals": {
            "feedback_count": r["feedback_count"],
            "issue_count": sum(count for _, count in r["status_rows"]),
        },
    }


@router.get("/analytics/summary")
def get_analytics_summary(
    days: int = Query(42, ge=1, le=MAX_DAYS),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get analytics summary including sentiment over time, topic sentiment, heatmap, pipeline, and totals (Admin only)."""
    _require_admin(current_user)
    return _assemble_analytics(days, _run_tasks(_analytics_tasks(days)))


def _alerts_tasks() -> Dict[str, Callable[[Session], Any]]:
    now = datetime.now(timezone.utc)
    hrs_72_ago = now - timedelta(hours=72)
    days_28_ago = now - timedelta(days=28)
    seven_days_ago = now - timedelta(days=7)
    fourteen_days_ago = now - timedelta(days=14)

    return {
        "spikes_raw": lambda db: db.query(
            Aspect.category,
            Location.name,
            func.count(Aspect.id).filter(Feedback.created_at >= hrs_72_ago).label("current_cnt"),
            func.count(Aspect.id).filter((Feedback.created_at >= days_28_ago) & (Feedback.created_at < hrs_72_ago)).label("prev_cnt"),
        )
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .join(Location, Location.id == Feedback.location_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= days_28_ago)
        .group_by(Aspect.category, Location.name)
        .all(),
        "trends_raw": lambda db: db.query(
            Aspect.category,
            func.count(Aspect.id).filter(Feedback.created_at >= seven_days_ago).label("this_week"),
            func.count(Aspect.id).filter((Feedback.created_at >= fourteen_days_ago) & (Feedback.created_at < seven_days_ago)).label("last_week"),
        )
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= fourteen_days_ago)
        .group_by(Aspect.category)
        .all(),
        # Same query as in _analytics_tasks, so the dashboard runs it once
        "categories": lambda db: [c for (c,) in db.query(Aspect.category).distinct().all() if c],
    }


def _assemble_alerts(r: Dict[str, Any]) -> Dict[str, Any]:
    # 1. Spikes: last 72h vs the average 3-day window of the 25 days before
    spikes = []
    windows_count = 28.0 / 3.0
    for cat, loc_name, current, prev_count in r["spikes_raw"]:
        current = current or 0
        prev_count = prev_count or 0
        baseline = prev_count / windows_count
        effective_baseline = max(baseline, 1.0)
        ratio = current / effective_baseline

        if ratio >= 2.0 and current >= 5:
            spikes.append(
                {
                    "category": cat,
                    "location_name": loc_name,
                    "current": current,
                    "baseline": round(baseline, 2),
                    "ratio": round(ratio, 2),
                }
            )

    # 2. Trends: this week vs last week, for every category ever seen
    trends_dict = {cat: {"this_week": tw or 0, "last_week": lw or 0} for cat, tw, lw in r["trends_raw"]}
    for cat in r["categories"]:
        if cat not in trends_dict:
            trends_dict[cat] = {"this_week": 0, "last_week": 0}

    trends = []
    for cat, counts in trends_dict.items():
        this_w = counts["this_week"]
        last_w = counts["last_week"]
        effective_last_w = max(last_w, 1)
        change_pct = round(((this_w - last_w) / effective_last_w) * 100.0, 2)
        trends.append({"category": cat, "change_pct": change_pct, "this_week": this_w, "last_week": last_w})

    return {"spikes": spikes, "trends": trends}


@router.get("/alerts")
def get_alerts(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Detect negative feedback spikes and category trends (Admin only)."""
    _require_admin(current_user)
    return _assemble_alerts(_run_tasks(_alerts_tasks()))


@router.get("/dashboard/summary")
def get_dashboard_summary(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Single consolidated endpoint for Admin Dashboard to eliminate multi-request latency."""
    _require_admin(current_user)

    from app.routers.issues import list_issues
    from app.routers.public import get_public_stats

    r = _run_tasks(
        {
            **_analytics_tasks(42),
            **_alerts_tasks(),
            "issues": lambda db: list_issues(
                status="active", category=None, assignee_id=None, current_user=current_user, db=db
            ),
            "stats": lambda db: get_public_stats(db=db),
        }
    )

    return {
        "analytics": _assemble_analytics(42, r),
        "issues": r["issues"],
        "alerts": _assemble_alerts(r),
        "stats": r["stats"],
    }
