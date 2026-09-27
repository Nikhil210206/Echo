from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer, joinedload, selectinload

from app.auth import get_current_user
from app.db import get_db, run_parallel
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
from app.services.lifecycle import score_issue

router = APIRouter(tags=["issues"])

ISSUE_STATUSES = {st.value for st in IssueStatus}


# --- Pydantic Schemas ---
class IssueUpdateRequest(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    public_response: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None


# --- Helper Functions ---
def build_issue_summary_response(db: Session, issue: Issue) -> Dict[str, Any]:
    """Builds complete dictionary for IssueSummary shape. Expects issue.location, issue.assignee and
    issue.aspects to be eager-loaded by the caller."""
    status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
    loc_name = issue.location.name if issue.location else "Unknown"

    aspects = issue.aspects
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

    score = float(issue.priority_score) if issue.priority_score is not None else score_issue(aspects)["score"]

    report_count = len(set(a.feedback_id for a in aspects if a.feedback_id))

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


def _load_issue_core(db: Session, issue_id: str) -> Optional[Dict[str, Any]]:
    """Issue with location, assignee, aspects and their feedback in two queries, turned into plain dicts."""
    issue = (
        db.query(Issue)
        .options(
            defer(Issue.centroid),
            joinedload(Issue.location),
            joinedload(Issue.assignee),
            selectinload(Issue.aspects).defer(Aspect.embedding).joinedload(Aspect.feedback),
        )
        .filter(Issue.id == issue_id)
        .first()
    )
    if not issue:
        return None

    evidence_list = []
    for a in issue.aspects:
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

    metrics = score_issue(issue.aspects)
    # The page shows the live score, so the headline number always matches its breakdown
    # (the stored one used for sorting is refreshed on every change and periodically)
    summary = {**build_issue_summary_response(db, issue), "priority_score": metrics["score"]}
    return {
        "assignee_id": issue.assignee_id,
        "summary": summary,
        "metrics": metrics,
        "evidence": evidence_list,
    }


def _load_issue_events(db: Session, issue_id: str) -> List[Dict[str, Any]]:
    rows = (
        db.query(IssueEvent, User.name)
        .outerjoin(User, User.id == IssueEvent.actor_id)
        .filter(IssueEvent.issue_id == issue_id)
        .order_by(IssueEvent.created_at.asc())
        .all()
    )
    return [
        {
            "id": ev.id,
            "from_status": ev.from_status,
            "to_status": ev.to_status,
            "actor": actor_name or "Echo",
            "note": ev.note,
            "created_at": ev.created_at,
        }
        for ev, actor_name in rows
    ]


def _load_issue_verifications(db: Session, issue_id: str) -> Dict[str, int]:
    counts = dict(
        db.query(Verification.fixed, func.count(Verification.id))
        .filter(Verification.issue_id == issue_id)
        .group_by(Verification.fixed)
        .all()
    )
    return {"fixed": counts.get(True, 0), "not_fixed": counts.get(False, 0)}


def _load_issue_rank(db: Session, issue_id: str) -> int:
    """1-based position among active issues by priority_score (0 if the issue is resolved)."""
    target = select(Issue.priority_score, Issue.status).where(Issue.id == issue_id).subquery()
    row = (
        db.query(
            target.c.status,
            select(func.count(Issue.id))
            .where(Issue.status != IssueStatus.resolved, Issue.priority_score > target.c.priority_score)
            .scalar_subquery(),
        )
        .first()
    )
    if not row or row[0] == IssueStatus.resolved:
        return 0
    return row[1] + 1


def build_issue_detail_response(issue_id: str) -> Optional[Tuple[Optional[str], Dict[str, Any]]]:
    """Builds the full detail response for an issue, running its independent queries in parallel.
    Returns (assignee_id, response), or None if the issue doesn't exist."""
    core, events_list, verification_summary, rank = run_parallel(
        lambda db: _load_issue_core(db, issue_id),
        lambda db: _load_issue_events(db, issue_id),
        lambda db: _load_issue_verifications(db, issue_id),
        lambda db: _load_issue_rank(db, issue_id),
    )
    if core is None:
        return None

    return core["assignee_id"], {
        **core["summary"],
        "breakdown": {**core["metrics"], "rank": rank},
        "events": events_list,
        "evidence": core["evidence"],
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
        if status != "active" and status not in ISSUE_STATUSES:
            raise AppError("VALIDATION_ERROR", f"Unknown status '{status}'", status_code=400, fields={"status": "invalid"})
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
    result = build_issue_detail_response(id)
    if result is None:
        raise AppError("NOT_FOUND", f"Issue with id '{id}' not found", status_code=404)
    assignee_id, detail = result

    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )

    if user_role_str == "staff" and assignee_id != current_user.id:
        raise AppError("FORBIDDEN", "Staff can only view assigned issues", status_code=403)

    return detail


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

    # assignee_id sent as null means "unassign"; left out means "no change"
    assignee_changed = "assignee_id" in payload.model_fields_set

    # Admin only check for assignee_id or title
    if (assignee_changed or payload.title is not None) and user_role_str != "admin":
        raise AppError("FORBIDDEN", "Only admins can change assignee or title", status_code=403)

    old_status_str = (
        issue.status.value if hasattr(issue.status, "value") else str(issue.status)
    )

    if assignee_changed and payload.assignee_id is not None:
        if not db.query(User.id).filter(User.id == payload.assignee_id).first():
            raise AppError("VALIDATION_ERROR", "No such user to assign", status_code=400, fields={"assignee_id": "not_found"})

    # Handle status change (setting the current status again changes nothing and logs nothing)
    if payload.status is not None and payload.status != old_status_str:
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
                    "Write a public response before resolving. Reporters and the public page will see it.",
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

    if assignee_changed:
        issue.assignee_id = payload.assignee_id

    if payload.public_response is not None:
        issue.public_response = payload.public_response

    db.commit()

    _, detail = build_issue_detail_response(id)

    if payload.status is not None and old_status_str != payload.status:
        broadcast_event(
            "issue_status",
            {
                "issue": {
                    "id": detail["id"],
                    "title": detail["title"],
                    "status": detail["status"],
                    "report_count": detail["report_count"],
                }
            },
        )

    return detail


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
        if role not in {r.value for r in UserRole}:
            raise AppError("VALIDATION_ERROR", f"Unknown role '{role}'", status_code=400, fields={"role": "invalid"})
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
