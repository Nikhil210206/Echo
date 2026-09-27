from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.db import get_db
from app.errors import AppError
from app.models import (
    Aspect,
    Feedback,
    Issue,
    IssueEvent,
    IssueStatus,
    Location,
    User,
    UserRole,
    Verification,
)
from app.routers.stream import broadcast_event

router = APIRouter(tags=["issues"])


# --- Pydantic Schemas ---
class IssueUpdateRequest(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    public_response: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None


# --- Helper Functions ---
def get_issue_report_count(db: Session, issue_id: str) -> int:
    """Returns the count of distinct feedback items linked to an issue."""
    return (
        db.query(func.count(func.distinct(Aspect.feedback_id)))
        .filter(Aspect.issue_id == issue_id)
        .scalar()
        or 0
    )


def calculate_issue_score_only(db: Session, issue: Issue) -> float:
    """Calculates recency_weighted * negative_share * urgency_multiplier score for an issue."""
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)

    # IN-subquery instead of JOIN + DISTINCT: Postgres can't DISTINCT over the json `flags` column
    linked_feedback = (
        db.query(Feedback)
        .filter(Feedback.id.in_(db.query(Aspect.feedback_id).filter(Aspect.issue_id == issue.id)))
        .all()
    )

    recent_reports = sum(
        1
        for fb in linked_feedback
        if fb.created_at
        and (
            fb.created_at.replace(tzinfo=timezone.utc)
            if fb.created_at.tzinfo is None
            else fb.created_at
        )
        >= seven_days_ago
    )
    older_reports = len(linked_feedback) - recent_reports
    recency_weighted = recent_reports + (older_reports * 0.5)

    linked_aspects = db.query(Aspect).filter(Aspect.issue_id == issue.id).all()
    total_aspects = len(linked_aspects)

    negative_share = (
        (sum(1 for a in linked_aspects if a.sentiment == "negative") / total_aspects)
        if total_aspects > 0
        else 0.0
    )

    urgency_multiplier = 1
    if any(a.urgency == "critical" for a in linked_aspects):
        urgency_multiplier = 3
    elif any(a.urgency == "high" for a in linked_aspects):
        urgency_multiplier = 2

    return round(recency_weighted * negative_share * urgency_multiplier, 4)


def calculate_issue_breakdown(db: Session, issue: Issue) -> Dict[str, Any]:
    """Calculates the breakdown metrics and global rank for an issue."""
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)

    # IN-subquery instead of JOIN + DISTINCT: Postgres can't DISTINCT over the json `flags` column
    linked_feedback = (
        db.query(Feedback)
        .filter(Feedback.id.in_(db.query(Aspect.feedback_id).filter(Aspect.issue_id == issue.id)))
        .all()
    )

    recent_reports = sum(
        1
        for fb in linked_feedback
        if fb.created_at
        and (
            fb.created_at.replace(tzinfo=timezone.utc)
            if fb.created_at.tzinfo is None
            else fb.created_at
        )
        >= seven_days_ago
    )
    older_reports = len(linked_feedback) - recent_reports
    recency_weighted = recent_reports + (older_reports * 0.5)

    linked_aspects = db.query(Aspect).filter(Aspect.issue_id == issue.id).all()
    total_aspects = len(linked_aspects)

    negative_share = (
        round(sum(1 for a in linked_aspects if a.sentiment == "negative") / total_aspects, 4)
        if total_aspects > 0
        else 0.0
    )

    urgency_multiplier = 1
    if any(a.urgency == "critical" for a in linked_aspects):
        urgency_multiplier = 3
    elif any(a.urgency == "high" for a in linked_aspects):
        urgency_multiplier = 2

    score = round(recency_weighted * negative_share * urgency_multiplier, 4)

    # Fast rank calculation among active issues using indexed priority_score
    active_issues = (
        db.query(Issue.id, Issue.priority_score)
        .filter(Issue.status != IssueStatus.resolved)
        .order_by(Issue.priority_score.desc().nullslast())
        .all()
    )
    rank = 0
    for idx, (iss_id, _) in enumerate(active_issues, start=1):
        if iss_id == issue.id:
            rank = idx
            break

    return {
        "recent_reports": recent_reports,
        "older_reports": older_reports,
        "recency_weighted": recency_weighted,
        "negative_share": negative_share,
        "urgency_multiplier": urgency_multiplier,
        "score": score,
        "rank": rank,
    }


def build_issue_summary_response(db: Session, issue: Issue) -> Dict[str, Any]:
    """Builds complete dictionary for IssueSummary shape."""
    status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
    loc_name = issue.location.name if issue.location else "Unknown"

    aspects = issue.aspects if hasattr(issue, "aspects") and issue.aspects is not None else db.query(Aspect).filter(Aspect.issue_id == issue.id).all()
    total_aspects = len(aspects)
    neg_share = (
        round(sum(1 for a in aspects if a.sentiment == "negative") / total_aspects, 4)
        if total_aspects > 0
        else 0.0
    )

    urgency_val = "normal"
    if any(a.urgency == "critical" for a in aspects):
        urgency_val = "critical"
    elif any(a.urgency == "high" for a in aspects):
        urgency_val = "high"

    assignee_data = None
    if issue.assignee:
        assignee_data = {"id": issue.assignee.id, "name": issue.assignee.name}

    score = (
        float(issue.priority_score)
        if issue.priority_score is not None
        else calculate_issue_score_only(db, issue)
    )

    report_count = len(set(a.feedback_id for a in aspects if a.feedback_id)) if hasattr(issue, "aspects") and issue.aspects is not None else get_issue_report_count(db, issue.id)

    return {
        "id": issue.id,
        "title": issue.title,
        "category": issue.category,
        "location_id": issue.location_id,
        "location_name": loc_name,
        "status": status_str,
        "priority_score": score,
        "report_count": report_count,
        "negative_share": neg_share,
        "urgency": urgency_val,
        "assignee": assignee_data,
        "public_response": issue.public_response,
        "reopened_count": issue.reopened_count or 0,
        "created_at": issue.created_at,
        "resolved_at": issue.resolved_at,
    }


def build_issue_detail_response(db: Session, issue: Issue) -> Dict[str, Any]:
    """Builds the full detail response dictionary for an issue."""
    base_summary = build_issue_summary_response(db, issue)
    breakdown = calculate_issue_breakdown(db, issue)

    events = (
        db.query(IssueEvent)
        .filter(IssueEvent.issue_id == issue.id)
        .order_by(IssueEvent.created_at.asc())
        .all()
    )
    events_list = []
    for ev in events:
        actor_name = "Echo"
        if ev.actor_id:
            user = db.query(User).filter(User.id == ev.actor_id).first()
            if user:
                actor_name = user.name
        events_list.append(
            {
                "id": ev.id,
                "from_status": ev.from_status,
                "to_status": ev.to_status,
                "actor": actor_name,
                "note": ev.note,
                "created_at": ev.created_at,
            }
        )

    aspects = db.query(Aspect).filter(Aspect.issue_id == issue.id).all()
    evidence_list = []
    for a in aspects:
        fb_obj = a.feedback
        evidence_list.append(
            {
                "feedback_id": a.feedback_id,
                "kind": fb_obj.kind.value if fb_obj and hasattr(fb_obj.kind, "value") else (fb_obj.kind if fb_obj else "text"),
                "text_redacted": fb_obj.text_redacted if fb_obj else None,
                "evidence_span": a.evidence_span,
                "sentiment": a.sentiment,
                "analyzed_by": fb_obj.analyzed_by if fb_obj else "lexicon",
                "created_at": fb_obj.created_at if fb_obj else issue.created_at,
            }
        )

    fixed_count = (
        db.query(func.count(Verification.id))
        .filter(Verification.issue_id == issue.id, Verification.fixed == True)  # noqa: E712
        .scalar()
        or 0
    )
    not_fixed_count = (
        db.query(func.count(Verification.id))
        .filter(Verification.issue_id == issue.id, Verification.fixed == False)  # noqa: E712
        .scalar()
        or 0
    )
    verification_summary = {"fixed": fixed_count, "not_fixed": not_fixed_count}

    return {
        **base_summary,
        "breakdown": breakdown,
        "events": events_list,
        "evidence": evidence_list,
        "verification": verification_summary,
    }


def check_valid_status_transition(current_status: str, new_status: str) -> None:
    """Validates that status only moves forward in open/reopened -> acknowledged -> in_progress -> resolved."""
    if current_status == new_status:
        return

    if new_status == "reopened":
        raise AppError("VALIDATION_ERROR", "Status cannot be manually set to reopened", status_code=400)

    allowed_next_states = {
        "open": {"acknowledged", "in_progress", "resolved"},
        "reopened": {"acknowledged", "in_progress", "resolved"},
        "acknowledged": {"in_progress", "resolved"},
        "in_progress": {"resolved"},
        "resolved": set(),
    }

    valid_targets = allowed_next_states.get(current_status, set())
    if new_status not in valid_targets:
        raise AppError("VALIDATION_ERROR", "Status can only move forward", status_code=400)


# --- Endpoints ---


@router.get("/issues")
def list_issues(
    status: Optional[str] = None,
    category: Optional[str] = None,
    assignee_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """List issues sorted by priority_score descending."""
    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )

    from sqlalchemy.orm import defer

    query = db.query(Issue).options(
        defer(Issue.centroid),
        joinedload(Issue.location),
        joinedload(Issue.assignee),
        joinedload(Issue.aspects).defer(Aspect.embedding),
    )

    # Force filter for staff role
    if user_role_str == "staff":
        query = query.filter(Issue.assignee_id == current_user.id)
    elif assignee_id:
        query = query.filter(Issue.assignee_id == assignee_id)

    if category:
        query = query.filter(Issue.category == category)

    if status:
        if status == "active":
            query = query.filter(Issue.status != IssueStatus.resolved)
        else:
            query = query.filter(Issue.status == status)

    issues = query.order_by(Issue.priority_score.desc().nullslast()).all()

    return [build_issue_summary_response(db, issue) for issue in issues]


@router.get("/issues/{id}")
def get_issue(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Retrieve issue detail with breakdown, events, evidence, and verification."""
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise AppError("NOT_FOUND", f"Issue with id '{id}' not found", status_code=404)

    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )

    if user_role_str == "staff" and issue.assignee_id != current_user.id:
        raise AppError("FORBIDDEN", "Staff can only view assigned issues", status_code=403)

    return build_issue_detail_response(db, issue)


@router.patch("/issues/{id}")
def update_issue(
    id: str,
    payload: IssueUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update issue status, title, assignee, or public_response."""
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise AppError("NOT_FOUND", f"Issue with id '{id}' not found", status_code=404)

    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )

    # Staff permission check
    if user_role_str == "staff" and issue.assignee_id != current_user.id:
        raise AppError("FORBIDDEN", "Staff can only modify assigned issues", status_code=403)

    # Admin only check for assignee_id or title
    if (payload.assignee_id is not None or payload.title is not None) and user_role_str != "admin":
        raise AppError("FORBIDDEN", "Only admins can change assignee or title", status_code=403)

    old_status_str = (
        issue.status.value if hasattr(issue.status, "value") else str(issue.status)
    )

    # Handle status change
    if payload.status is not None:
        new_status_str = payload.status
        check_valid_status_transition(old_status_str, new_status_str)

        if new_status_str == "resolved":
            final_response = (
                payload.public_response
                if payload.public_response is not None
                else issue.public_response
            )
            if not final_response or not final_response.strip():
                raise AppError(
                    "VALIDATION_ERROR",
                    "public_response required to resolve",
                    status_code=400,
                    fields={"public_response": "required"},
                )
            issue.resolved_at = datetime.now(timezone.utc)

        issue.status = IssueStatus(new_status_str) if hasattr(IssueStatus, new_status_str) else new_status_str

        # Create IssueEvent record for status change
        event = IssueEvent(
            issue_id=issue.id,
            from_status=old_status_str,
            to_status=new_status_str,
            actor_id=current_user.id,
            note=payload.note,
        )
        db.add(event)

    if payload.title is not None:
        issue.title = payload.title

    if payload.assignee_id is not None:
        issue.assignee_id = payload.assignee_id

    if payload.public_response is not None:
        issue.public_response = payload.public_response

    db.commit()
    db.refresh(issue)

    if payload.status is not None and old_status_str != payload.status:
        report_count = get_issue_report_count(db, issue.id)
        status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
        broadcast_event(
            "issue_status",
            {
                "issue": {
                    "id": issue.id,
                    "title": issue.title,
                    "status": status_str,
                    "report_count": report_count,
                }
            },
        )

    return build_issue_detail_response(db, issue)


@router.get("/users")
def list_users(
    role: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """List users filtered by role (Admin only)."""
    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )
    if user_role_str != "admin":
        raise AppError("FORBIDDEN", "Admin access required", status_code=403)

    query = db.query(User)
    if role:
        query = query.filter(User.role == role)

    users = query.all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "team": u.team,
        }
        for u in users
    ]
