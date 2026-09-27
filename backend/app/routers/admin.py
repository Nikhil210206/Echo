from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.auth import get_current_user
from app.db import get_db
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

router = APIRouter(tags=["admin"])


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
    days: Optional[int] = None,
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

    db.commit()
    db.refresh(fb)

    record = format_feedback_record(fb)
    broadcast_event("moderation", {"feedback": record})
    return record


@router.get("/analytics/summary")
def get_analytics_summary(
    days: int = Query(42, ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get analytics summary including sentiment over time, topic sentiment, heatmap, pipeline, and totals (Admin only)."""
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    # 1. sentiment_over_time
    start_date = (now - timedelta(days=days)).date()
    end_date = now.date()

    date_map: Dict[str, Dict[str, Any]] = {}
    curr_d = start_date
    while curr_d <= end_date:
        d_str = curr_d.strftime("%Y-%m-%d")
        date_map[d_str] = {"date": d_str, "positive": 0, "neutral": 0, "negative": 0}
        curr_d += timedelta(days=1)

    feedbacks_in_period = db.query(Feedback).filter(Feedback.created_at >= cutoff).all()

    for fb in feedbacks_in_period:
        if fb.created_at:
            d_str = fb.created_at.strftime("%Y-%m-%d")
            if d_str in date_map:
                sent = (fb.overall_sentiment or "neutral").lower()
                if sent == "positive":
                    date_map[d_str]["positive"] += 1
                elif sent == "negative":
                    date_map[d_str]["negative"] += 1
                else:
                    date_map[d_str]["neutral"] += 1

    sentiment_over_time = list(date_map.values())

    # 2. topic_sentiment
    aspects_in_period = (
        db.query(Aspect)
        .options(defer(Aspect.embedding))
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Feedback.created_at >= cutoff)
        .all()
    )

    topic_map: Dict[str, Dict[str, int]] = {}
    for a in aspects_in_period:
        cat = a.category or "general"
        if cat not in topic_map:
            topic_map[cat] = {"category": cat, "positive": 0, "negative": 0}
        sent = (a.sentiment or "neutral").lower()
        if sent == "positive":
            topic_map[cat]["positive"] += 1
        elif sent == "negative":
            topic_map[cat]["negative"] += 1

    topic_sentiment = list(topic_map.values())

    # 3. heatmap
    locations = db.query(Location).all()
    loc_names = [l.name for l in locations]
    categories_set = set(a.category for a in db.query(Aspect.category).distinct().all() if a[0])
    cat_names = sorted(list(categories_set)) if categories_set else ["general", "infrastructure", "hostel", "mess"]

    values_matrix = [[0 for _ in cat_names] for _ in loc_names]
    loc_index_map = {loc_name: idx for idx, loc_name in enumerate(loc_names)}
    cat_index_map = {cat_name: idx for idx, cat_name in enumerate(cat_names)}

    negative_aspects = (
        db.query(Aspect)
        .options(
            defer(Aspect.embedding),
            joinedload(Aspect.feedback).joinedload(Feedback.location),
        )
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= cutoff)
        .all()
    )

    for a in negative_aspects:
        if a.feedback and a.feedback.location:
            l_name = a.feedback.location.name
            c_name = a.category
            if l_name in loc_index_map and c_name in cat_index_map:
                r = loc_index_map[l_name]
                c = cat_index_map[c_name]
                values_matrix[r][c] += 1

    heatmap = {
        "locations": loc_names,
        "categories": cat_names,
        "values": values_matrix,
    }

    # 4. pipeline
    issues = db.query(Issue).all()
    pipeline_counts = {
        "open": 0,
        "acknowledged": 0,
        "in_progress": 0,
        "resolved": 0,
        "reopened": 0,
    }

    resolved_days = []
    for issue in issues:
        status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
        if status_str in pipeline_counts:
            pipeline_counts[status_str] += 1

        if issue.resolved_at and issue.created_at:
            delta = (issue.resolved_at - issue.created_at).total_seconds() / 86400.0
            resolved_days.append(delta)

    avg_days_to_resolve = round(sum(resolved_days) / len(resolved_days), 2) if resolved_days else 0.0

    pipeline = [
        {"status": "open", "count": pipeline_counts["open"]},
        {"status": "acknowledged", "count": pipeline_counts["acknowledged"]},
        {"status": "in_progress", "count": pipeline_counts["in_progress"]},
        {"status": "resolved", "count": pipeline_counts["resolved"]},
        {"status": "reopened", "count": pipeline_counts["reopened"]},
    ]

    # 5. totals
    total_feedback = db.query(func.count(Feedback.id)).scalar() or 0
    total_issues = len(issues)

    totals = {
        "feedback_count": total_feedback,
        "issue_count": total_issues,
    }

    return {
        "sentiment_over_time": sentiment_over_time,
        "topic_sentiment": topic_sentiment,
        "heatmap": heatmap,
        "pipeline": pipeline,
        "avg_days_to_resolve": avg_days_to_resolve,
        "totals": totals,
    }


@router.get("/alerts")
def get_alerts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Detect negative feedback spikes and category trends (Admin only)."""
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    now = datetime.now(timezone.utc)
    hrs_72_ago = now - timedelta(hours=72)
    days_28_ago = now - timedelta(days=28)

    # 1. Spikes calculation: single SQL query joining Aspect, Feedback, Location
    spikes_raw = (
        db.query(
            Aspect.category,
            Location.name,
            func.count(Aspect.id).filter(Feedback.created_at >= hrs_72_ago).label("current_cnt"),
            func.count(Aspect.id).filter((Feedback.created_at >= days_28_ago) & (Feedback.created_at < hrs_72_ago)).label("prev_cnt"),
        )
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .join(Location, Location.id == Feedback.location_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= days_28_ago)
        .group_by(Aspect.category, Location.name)
        .all()
    )

    spikes = []
    windows_count = 28.0 / 3.0
    for cat, loc_name, current, prev_count in spikes_raw:
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

    # 2. Trends calculation: single SQL query joining Aspect and Feedback
    seven_days_ago = now - timedelta(days=7)
    fourteen_days_ago = now - timedelta(days=14)

    trends_raw = (
        db.query(
            Aspect.category,
            func.count(Aspect.id).filter(Feedback.created_at >= seven_days_ago).label("this_week"),
            func.count(Aspect.id).filter((Feedback.created_at >= fourteen_days_ago) & (Feedback.created_at < seven_days_ago)).label("last_week"),
        )
        .join(Feedback, Feedback.id == Aspect.feedback_id)
        .filter(Aspect.sentiment == "negative", Feedback.created_at >= fourteen_days_ago)
        .group_by(Aspect.category)
        .all()
    )

    trends_dict = {cat: {"this_week": tw or 0, "last_week": lw or 0} for cat, tw, lw in trends_raw}

    # Ensure all distinct categories are present
    all_cats = [c[0] for c in db.query(Aspect.category).distinct().all() if c[0]]
    for cat in all_cats:
        if cat not in trends_dict:
            trends_dict[cat] = {"this_week": 0, "last_week": 0}

    trends = []
    for cat, counts in trends_dict.items():
        this_w = counts["this_week"]
        last_w = counts["last_week"]
        effective_last_w = max(last_w, 1)
        change_pct = round(((this_w - last_w) / effective_last_w) * 100.0, 2)

        trends.append(
            {
                "category": cat,
                "change_pct": change_pct,
                "this_week": this_w,
                "last_week": last_w,
            }
        )

    return {
        "spikes": spikes,
        "trends": trends,
    }


@router.get("/dashboard/summary")
def get_dashboard_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Single consolidated endpoint for Admin Dashboard to eliminate multi-request latency."""
    user_role_str = (
        current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    from app.routers.issues import list_issues
    from app.routers.public import get_public_stats

    analytics_data = get_analytics_summary(days=42, current_user=current_user, db=db)
    active_issues = list_issues(status="active", current_user=current_user, db=db)
    alerts_data = get_alerts(current_user=current_user, db=db)
    stats_data = get_public_stats(db=db)

    return {
        "analytics": analytics_data,
        "issues": active_issues,
        "alerts": alerts_data,
        "stats": stats_data,
    }
