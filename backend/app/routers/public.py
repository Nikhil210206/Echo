import asyncio
import secrets
import string
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import AppError
from app.models import (
    Aspect,
    Feedback,
    FeedbackKind,
    FeedbackStatus,
    Issue,
    IssueEvent,
    IssueStatus,
    Location,
    Verification,
)
from app.routers.stream import broadcast_event
from app.services.analysis import run_analysis_pipeline
from app.services.lifecycle import (
    current_round_votes,
    link_negative_aspects,
    reported_before_fix,
    rescore_issues,
)

router = APIRouter(tags=["public"])


# --- Pydantic Schemas ---
class FeedbackCreateRequest(BaseModel):
    text: str
    location_slug: str
    website: Optional[str] = None


class MeTooRequest(BaseModel):
    device_id: str


class VerifyRequest(BaseModel):
    issue_id: str
    fixed: bool


# --- Helper Functions ---
def generate_tracking_code(db: Session, length: int = 8) -> str:
    """Generates an 8-character unique alphanumeric tracking code."""
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(length))
        existing = db.query(Feedback).filter(Feedback.tracking_code == code).first()
        if not existing:
            return code


def get_issue_report_count(db: Session, issue_id: str) -> int:
    """Returns the total number of distinct feedback submissions linked to an issue."""
    return (
        db.query(func.count(func.distinct(Aspect.feedback_id)))
        .filter(Aspect.issue_id == issue_id)
        .scalar()
        or 0
    )


def get_issue_verifications(db: Session, issue_id: str) -> Dict[str, int]:
    """Returns counts for fixed and not_fixed community verifications for an issue."""
    fixed_count = (
        db.query(func.count(Verification.id))
        .filter(Verification.issue_id == issue_id, Verification.fixed == True)  # noqa: E712
        .scalar()
        or 0
    )
    not_fixed_count = (
        db.query(func.count(Verification.id))
        .filter(Verification.issue_id == issue_id, Verification.fixed == False)  # noqa: E712
        .scalar()
        or 0
    )
    return {"fixed": fixed_count, "not_fixed": not_fixed_count}


def build_track_response(db: Session, fb: Feedback) -> Dict[str, Any]:
    """Builds response for GET /track/{code} and POST /track/{code}/verify."""
    loc_name = fb.location.name if fb.location else "Unknown"

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

    issue_ids = list(set(a.issue_id for a in fb.aspects if a.issue_id))
    issues_list = []
    if issue_ids:
        db_issues = db.query(Issue).filter(Issue.id.in_(issue_ids)).all()
        for issue in db_issues:
            # Votes on the latest resolution only: after a re-fix, earlier reporters can check again
            user_verification = next(
                (v for v in current_round_votes(db, issue) if v.tracking_code == fb.tracking_code), None
            )
            my_vote = user_verification.fixed if user_verification else None
            issue_status_str = (
                issue.status.value if hasattr(issue.status, "value") else str(issue.status)
            )
            can_verify = (
                issue_status_str == "resolved" and user_verification is None and reported_before_fix(fb, issue)
            )

            events = (
                db.query(IssueEvent)
                .filter(IssueEvent.issue_id == issue.id)
                .order_by(IssueEvent.created_at.asc())
                .all()
            )
            timeline = [
                {
                    "id": ev.id,
                    "from_status": ev.from_status,
                    "to_status": ev.to_status,
                    "note": ev.note,
                    "created_at": ev.created_at,
                }
                for ev in events
            ]

            verif_summary = get_issue_verifications(db, issue.id)

            issues_list.append(
                {
                    "id": issue.id,
                    "title": issue.title,
                    "category": issue.category,
                    "location_name": issue.location.name if issue.location else "Unknown",
                    "status": issue_status_str,
                    "report_count": get_issue_report_count(db, issue.id),
                    "public_response": issue.public_response,
                    "timeline": timeline,
                    "can_verify": can_verify,
                    "my_vote": my_vote,
                    "verification": verif_summary,
                }
            )

    kind_str = fb.kind.value if hasattr(fb.kind, "value") else str(fb.kind)
    status_str = fb.status.value if hasattr(fb.status, "value") else str(fb.status)

    return {
        "tracking_code": fb.tracking_code,
        "kind": kind_str,
        "submitted_at": fb.created_at,
        "location_name": loc_name,
        "moderation_status": status_str,
        "aspects": aspects_list,
        "issues": issues_list,
    }


# --- Endpoints ---


@router.get("/locations/public")
def get_locations_public(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Returns all locations as [{id, name, slug, zone}]."""
    locations = db.query(Location).all()
    return [
        {"id": loc.id, "name": loc.name, "slug": loc.slug, "zone": loc.zone}
        for loc in locations
    ]


@router.get("/locations/{slug}")
def get_location_by_slug(slug: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Returns {id, name, slug, zone} for a location slug or 404 if missing."""
    loc = db.query(Location).filter(Location.slug == slug).first()
    if not loc:
        raise AppError("NOT_FOUND", f"Location with slug '{slug}' not found", status_code=404)
    return {"id": loc.id, "name": loc.name, "slug": loc.slug, "zone": loc.zone}


@router.get("/locations/{slug}/issues")
def get_location_issues(slug: str, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Returns top 3 open issues (status != resolved) at location ordered by priority_score desc."""
    loc = db.query(Location).filter(Location.slug == slug).first()
    if not loc:
        raise AppError("NOT_FOUND", f"Location with slug '{slug}' not found", status_code=404)

    issues = (
        db.query(Issue)
        .filter(Issue.location_id == loc.id, Issue.status != IssueStatus.resolved)
        .order_by(Issue.priority_score.desc())
        .limit(3)
        .all()
    )

    result = []
    for issue in issues:
        status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
        result.append(
            {
                "id": issue.id,
                "title": issue.title,
                "category": issue.category,
                "location_name": loc.name,
                "status": status_str,
                "report_count": get_issue_report_count(db, issue.id),
                "public_response": issue.public_response,
                "created_at": issue.created_at,
                "resolved_at": issue.resolved_at,
            }
        )
    return result


@router.post("/feedback")
async def submit_feedback(
    payload: FeedbackCreateRequest, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Submit public feedback and run real analysis pipeline, clustering, and priority scoring."""
    if payload.website and payload.website.strip():
        raise AppError("SPAM_DETECTED", "Bot detected", status_code=400)

    raw_text = payload.text.strip() if payload.text else ""
    if len(raw_text) < 10:
        raise AppError(
            "VALIDATION_ERROR",
            "Feedback text must be at least 10 characters",
            status_code=400,
            fields={"text": "too_short"},
        )
    if len(raw_text) > 1000:
        raise AppError(
            "VALIDATION_ERROR",
            "Feedback text cannot exceed 1000 characters",
            status_code=400,
            fields={"text": "too_long"},
        )

    # Database work runs in a thread: blocking queries in this async handler would stall every other request
    loc = await asyncio.to_thread(lambda: db.query(Location).filter(Location.slug == payload.location_slug).first())
    if not loc:
        raise AppError("NOT_FOUND", f"Location with slug '{payload.location_slug}' not found", status_code=404)

    # 1. Run real analysis pipeline
    analysis_result = await run_analysis_pipeline(payload.text)

    return await asyncio.to_thread(_store_feedback, db, payload, loc, analysis_result)


def _store_feedback(db: Session, payload: FeedbackCreateRequest, loc: Location, analysis_result) -> Dict[str, Any]:
    """Saves analyzed feedback, clusters its negative aspects into issues and rescores them."""
    # 2. Build flags from moderation booleans
    mod = analysis_result.moderation
    flags = []
    if mod.is_spam:
        flags.append("spam")
    if mod.is_gibberish:
        flags.append("gibberish")
    if mod.is_duplicate_flood:
        flags.append("duplicate_flood")
    if mod.is_off_topic:
        flags.append("off_topic")
    if mod.is_abusive:
        flags.append("abusive")

    if mod.masked_text and mod.masked_text != payload.text:
        flags.append("profanity_masked")

    feedback_status = FeedbackStatus.pending if mod.flagged else FeedbackStatus.approved

    # 3. Generate tracking code
    code = generate_tracking_code(db)

    # 4. Save Feedback record
    feedback = Feedback(
        kind=FeedbackKind.text,
        text_redacted=analysis_result.text_redacted,
        location_id=loc.id,
        tracking_code=code,
        status=feedback_status,
        overall_sentiment=analysis_result.overall_sentiment,
        analyzed_by=analysis_result.analyzed_by,
        flags=flags,
    )
    db.add(feedback)
    db.flush()

    # 5. Save aspects. Only approved feedback joins issues: flagged feedback waits unlinked in the
    # moderation queue and is linked if an admin approves it (see app.services.lifecycle)
    db_aspects = [
        Aspect(
            feedback_id=feedback.id,
            aspect=aspect_item.aspect,
            category=aspect_item.category,
            sentiment=aspect_item.sentiment,
            urgency=aspect_item.urgency,
            evidence_span=aspect_item.evidence_span,
        )
        for aspect_item in analysis_result.aspects
    ]
    db.add_all(db_aspects)
    db.flush()

    if feedback_status == FeedbackStatus.approved:
        # 6. Cluster negative aspects into issues and recalculate their priority scores
        rescore_issues(db, link_negative_aspects(db, db_aspects, loc.id))

    aspects_out = [
        {
            "id": a.id,
            "aspect": a.aspect,
            "category": a.category,
            "sentiment": a.sentiment,
            "urgency": a.urgency,
            "evidence_span": a.evidence_span,
        }
        for a in db_aspects
    ]

    db.commit()
    db.refresh(feedback)

    # 7. Broadcast event
    status_str = feedback.status.value if hasattr(feedback.status, "value") else str(feedback.status)
    fb_record = {
        "id": feedback.id,
        "text_redacted": feedback.text_redacted,
        "location_name": loc.name,
        "tracking_code": feedback.tracking_code,
        "status": status_str,
        "overall_sentiment": feedback.overall_sentiment,
        "analyzed_by": feedback.analyzed_by,
        "flags": feedback.flags or [],
        "created_at": feedback.created_at,
        "aspects": aspects_out,
    }
    broadcast_event("feedback", {"feedback": fb_record})

    return {
        "tracking_code": feedback.tracking_code,
        "text_redacted": feedback.text_redacted,
        "analyzed_by": feedback.analyzed_by,
        "aspects": aspects_out,
    }


@router.post("/issues/{id}/metoo")
def submit_me_too(id: str, payload: MeTooRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Submit a 'me too' vote for an issue."""
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise AppError("NOT_FOUND", f"Issue with id '{id}' not found", status_code=404)

    existing_feedback = (
        db.query(Feedback)
        .join(Aspect, Aspect.feedback_id == Feedback.id)
        .filter(
            Feedback.kind == FeedbackKind.me_too,
            Feedback.device_hash == payload.device_id,
            Aspect.issue_id == issue.id,
        )
        .first()
    )

    if existing_feedback:
        raise AppError(
            "ALREADY_REPORTED",
            "You have already reported this issue",
            status_code=409,
            fields={"tracking_code": existing_feedback.tracking_code},
        )

    code = generate_tracking_code(db)
    feedback = Feedback(
        kind=FeedbackKind.me_too,
        device_hash=payload.device_id,
        location_id=issue.location_id,
        tracking_code=code,
        status=FeedbackStatus.approved,
        text_redacted=None,
    )
    db.add(feedback)
    db.flush()

    aspect = Aspect(
        feedback_id=feedback.id,
        aspect="me_too",
        category=issue.category,
        sentiment="negative",
        urgency="normal",
        issue_id=issue.id,
    )
    db.add(aspect)
    db.commit()

    updated_report_count = get_issue_report_count(db, issue.id)
    issue_status_str = issue.status.value if hasattr(issue.status, "value") else str(issue.status)
    broadcast_event(
        "me_too",
        {
            "issue": {
                "id": issue.id,
                "title": issue.title,
                "status": issue_status_str,
                "report_count": updated_report_count,
            }
        },
    )
    return {"tracking_code": code, "report_count": updated_report_count}


@router.get("/track/{code}")
def track_feedback(code: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Retrieve status and linked issue details by feedback tracking code."""
    clean_code = code.replace("ECH-", "").strip()
    fb = db.query(Feedback).filter(
        (Feedback.tracking_code == code) | (Feedback.tracking_code == clean_code)
    ).first()
    if not fb:
        raise AppError("NOT_FOUND", f"Tracking code '{code}' not found", status_code=404)

    return build_track_response(db, fb)


@router.post("/track/{code}/verify")
def verify_issue_resolution(
    code: str, payload: VerifyRequest, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Verify fixed / not fixed status for a resolved issue."""
    clean_code = code.replace("ECH-", "").strip()
    fb = db.query(Feedback).filter(
        (Feedback.tracking_code == code) | (Feedback.tracking_code == clean_code)
    ).first()
    if not fb:
        raise AppError("NOT_FOUND", f"Tracking code '{code}' not found", status_code=404)

    issue = db.query(Issue).filter(Issue.id == payload.issue_id).first()
    if not issue:
        raise AppError("NOT_FOUND", f"Issue with id '{payload.issue_id}' not found", status_code=404)

    # Only people whose report is part of this issue can vote, only once the fix has been announced,
    # and only if they reported before it (new codes minted afterwards can't swing the vote)
    if not any(a.issue_id == issue.id for a in fb.aspects):
        raise AppError("NOT_LINKED", "This report isn't part of that issue", status_code=403)
    if issue.status != IssueStatus.resolved:
        raise AppError("NOT_RESOLVED", "This issue hasn't been marked fixed yet, so there's nothing to verify", status_code=409)
    if not reported_before_fix(fb, issue):
        raise AppError("REPORTED_AFTER_FIX", "Only reports made before the fix can verify it", status_code=403)

    # Votes are keyed by the stored code, so "ECH-XXXX" and "XXXX" can't vote twice
    votes = current_round_votes(db, issue)
    if any(v.tracking_code == fb.tracking_code for v in votes):
        raise AppError("ALREADY_VOTED", "You have already verified this issue", status_code=409)

    verification = Verification(
        issue_id=issue.id,
        tracking_code=fb.tracking_code,
        fixed=payload.fixed,
    )
    db.add(verification)
    votes.append(verification)

    total_votes = len(votes)
    not_fixed_count = sum(1 for v in votes if not v.fixed)

    # The issue is resolved here (checked above), so this reopens it once; later votes are rejected
    if total_votes >= 3 and (not_fixed_count / total_votes) >= 0.30:
        issue.status = IssueStatus.reopened
        issue.reopened_count = (issue.reopened_count or 0) + 1
        event = IssueEvent(
            issue_id=issue.id,
            from_status=IssueStatus.resolved.value,
            to_status="reopened",
            note="Reopened automatically based on community verifications",
        )
        db.add(event)

    db.commit()
    db.refresh(fb)

    return build_track_response(db, fb)


@router.get("/public/stats")
def get_public_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get aggregated platform statistics."""
    # One round trip: every figure is a scalar subquery of a single SELECT
    def scalar(*columns_and_filters):
        column, *filters = columns_and_filters
        return select(column).where(*filters).scalar_subquery()

    row = db.query(
        scalar(func.count(func.distinct(Feedback.tracking_code))),
        scalar(func.count(Feedback.id)),
        scalar(func.count(Issue.id)),
        scalar(func.count(Issue.id), Issue.public_response.isnot(None), Issue.public_response != ""),
        scalar(func.count(Issue.id), Issue.status == IssueStatus.resolved),
        scalar(func.count(Verification.id)),
        scalar(func.count(Verification.id), Verification.fixed == True),  # noqa: E712
        scalar(
            func.avg(func.extract("epoch", Issue.resolved_at - Issue.created_at)),
            Issue.resolved_at.isnot(None),
        ),
    ).one()
    (
        people_heard,
        total_feedback,
        total_issues,
        issues_with_resp,
        resolved_count,
        total_verif,
        fixed_verif,
        avg_resolve_seconds,
    ) = row

    response_rate = round((issues_with_resp / total_issues), 4) if total_issues > 0 else 0.0
    resolved_share = round(resolved_count / total_issues, 4) if total_issues > 0 else 0.0
    verified_fix_rate = round(fixed_verif / total_verif, 4) if total_verif > 0 else 0.0
    avg_days_to_resolve = round(float(avg_resolve_seconds) / 86400.0, 2) if avg_resolve_seconds is not None else 0.0

    return {
        "people_heard": people_heard,
        "total_feedback": total_feedback,
        "response_rate": response_rate,
        "avg_days_to_resolve": avg_days_to_resolve,
        "verified_fix_rate": verified_fix_rate,
        "resolved_share": resolved_share,
    }


@router.get("/public/issues")
def get_public_issues(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """List all public issues without feedback text."""
    from sqlalchemy.orm import joinedload

    all_issues = db.query(Issue).options(joinedload(Issue.location)).order_by(Issue.created_at.desc()).all()
    if not all_issues:
        return []

    issue_ids = [i.id for i in all_issues]

    # Batch query report counts
    report_counts = dict(
        db.query(Aspect.issue_id, func.count(func.distinct(Aspect.feedback_id)))
        .filter(Aspect.issue_id.in_(issue_ids))
        .group_by(Aspect.issue_id)
        .all()
    )

    # Batch query verifications
    verifications_fixed = dict(
        db.query(Verification.issue_id, func.count(Verification.id))
        .filter(Verification.issue_id.in_(issue_ids), Verification.fixed == True)  # noqa: E712
        .group_by(Verification.issue_id)
        .all()
    )
    verifications_not_fixed = dict(
        db.query(Verification.issue_id, func.count(Verification.id))
        .filter(Verification.issue_id.in_(issue_ids), Verification.fixed == False)  # noqa: E712
        .group_by(Verification.issue_id)
        .all()
    )

    result = []
    for issue in all_issues:
        status_str = (
            issue.status.value if hasattr(issue.status, "value") else str(issue.status)
        )
        result.append(
            {
                "id": issue.id,
                "title": issue.title,
                "category": issue.category,
                "location_name": issue.location.name if issue.location else "Unknown",
                "status": status_str,
                "report_count": report_counts.get(issue.id, 0),
                "public_response": issue.public_response,
                "created_at": issue.created_at,
                "resolved_at": issue.resolved_at,
                "verification": {
                    "fixed": verifications_fixed.get(issue.id, 0),
                    "not_fixed": verifications_not_fixed.get(issue.id, 0),
                },
            }
        )
    return result
