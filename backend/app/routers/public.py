import secrets
import string
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
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
from app.services.cluster import cluster_aspect, compute_updated_centroid
from app.services.priority import calculate_priority_score

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
            user_verification = (
                db.query(Verification)
                .filter(
                    Verification.issue_id == issue.id,
                    Verification.tracking_code == fb.tracking_code,
                )
                .first()
            )
            my_vote = user_verification.fixed if user_verification else None
            issue_status_str = (
                issue.status.value if hasattr(issue.status, "value") else str(issue.status)
            )
            can_verify = (issue_status_str == "resolved") and (user_verification is None)

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

    loc = db.query(Location).filter(Location.slug == payload.location_slug).first()
    if not loc:
        raise AppError("NOT_FOUND", f"Location with slug '{payload.location_slug}' not found", status_code=404)

    # 1. Run real analysis pipeline
    analysis_result = await run_analysis_pipeline(payload.text)

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

    touched_issue_ids = set()
    aspects_out = []

    # 5. Process aspects & clustering for negative aspects
    for aspect_item in analysis_result.aspects:
        db_aspect = Aspect(
            feedback_id=feedback.id,
            aspect=aspect_item.aspect,
            category=aspect_item.category,
            sentiment=aspect_item.sentiment,
            urgency=aspect_item.urgency,
            evidence_span=aspect_item.evidence_span,
        )

        if aspect_item.sentiment == "negative":
            open_db_issues = (
                db.query(Issue)
                .filter(
                    Issue.location_id == loc.id,
                    Issue.category == aspect_item.category,
                    Issue.status != IssueStatus.resolved,
                )
                .all()
            )

            open_issues_dicts = [
                {
                    "id": iss.id,
                    "category": iss.category,
                    "location_id": iss.location_id,
                    "centroid": iss.centroid,
                    "title": iss.title,
                    "status": iss.status.value if hasattr(iss.status, "value") else str(iss.status),
                }
                for iss in open_db_issues
            ]

            match_res = cluster_aspect(
                aspect_text=aspect_item.evidence_span or aspect_item.aspect,
                aspect_category=aspect_item.category,
                aspect_location_id=loc.id,
                open_issues=open_issues_dicts,
            )

            if match_res.should_join and match_res.matched_issue_id:
                matched_issue = db.query(Issue).filter(Issue.id == match_res.matched_issue_id).first()
                if matched_issue:
                    db_aspect.issue_id = matched_issue.id
                    existing_aspect_count = (
                        db.query(func.count(Aspect.id))
                        .filter(Aspect.issue_id == matched_issue.id)
                        .scalar()
                        or 0
                    )
                    updated_centroid = compute_updated_centroid(
                        current_centroid=matched_issue.centroid or [],
                        current_count=existing_aspect_count,
                        new_embedding=match_res.embedding,
                    )
                    matched_issue.centroid = updated_centroid
                    touched_issue_ids.add(matched_issue.id)
            else:
                new_title = f"{aspect_item.category.capitalize()}: {aspect_item.evidence_span[:50]}"
                new_issue = Issue(
                    title=new_title,
                    category=aspect_item.category,
                    location_id=loc.id,
                    status=IssueStatus.open,
                    centroid=match_res.embedding,
                    priority_score=0.0,
                )
                db.add(new_issue)
                db.flush()
                db_aspect.issue_id = new_issue.id
                touched_issue_ids.add(new_issue.id)

        db.add(db_aspect)
        db.flush()

        aspects_out.append(
            {
                "id": db_aspect.id,
                "aspect": db_aspect.aspect,
                "category": db_aspect.category,
                "sentiment": db_aspect.sentiment,
                "urgency": db_aspect.urgency,
                "evidence_span": db_aspect.evidence_span,
            }
        )

    # 6. Recalculate priority scores for touched issues
    for iss_id in touched_issue_ids:
        target_issue = db.query(Issue).filter(Issue.id == iss_id).first()
        if not target_issue:
            continue

        linked_aspects = db.query(Aspect).filter(Aspect.issue_id == target_issue.id).all()
        reports_data = []
        highest_urgency = "normal"
        urgency_levels = {"critical": 3, "high": 2, "normal": 1}
        max_urg_val = 1

        for a in linked_aspects:
            urg_val = urgency_levels.get(a.urgency.lower(), 1)
            if urg_val > max_urg_val:
                max_urg_val = urg_val
                highest_urgency = a.urgency.lower()

            fb_obj = a.feedback
            reports_data.append(
                {
                    "created_at": fb_obj.created_at if fb_obj else target_issue.created_at,
                    "sentiment": a.sentiment,
                }
            )

        pri_result = calculate_priority_score(reports_data, highest_urgency=highest_urgency)
        target_issue.priority_score = pri_result.priority_score

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

    existing_vote = (
        db.query(Verification)
        .filter(Verification.issue_id == issue.id, Verification.tracking_code == code)
        .first()
    )
    if existing_vote:
        raise AppError("ALREADY_VOTED", "You have already verified this issue", status_code=409)

    verification = Verification(
        issue_id=issue.id,
        tracking_code=code,
        fixed=payload.fixed,
    )
    db.add(verification)
    db.flush()

    all_verifications = (
        db.query(Verification).filter(Verification.issue_id == issue.id).all()
    )
    total_votes = len(all_verifications)
    not_fixed_count = sum(1 for v in all_verifications if not v.fixed)

    if total_votes >= 3 and (not_fixed_count / total_votes) >= 0.30:
        from_status_str = (
            issue.status.value if hasattr(issue.status, "value") else str(issue.status)
        )
        issue.status = IssueStatus.reopened
        issue.reopened_count = (issue.reopened_count or 0) + 1
        event = IssueEvent(
            issue_id=issue.id,
            from_status=from_status_str,
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
    people_heard = db.query(func.count(func.distinct(Feedback.tracking_code))).scalar() or 0
    total_feedback = db.query(func.count(Feedback.id)).scalar() or 0

    # Combine issue stats into 1 query
    iss_stats = db.query(
        func.count(Issue.id).label("total"),
        func.count(Issue.id).filter(Issue.public_response.isnot(None), Issue.public_response != "").label("with_resp"),
        func.count(Issue.id).filter(Issue.status == IssueStatus.resolved).label("resolved_cnt"),
    ).first()

    total_issues = iss_stats.total if iss_stats else 0
    issues_with_resp = iss_stats.with_resp if iss_stats else 0
    resolved_count = iss_stats.resolved_cnt if iss_stats else 0

    response_rate = round((issues_with_resp / total_issues), 4) if total_issues > 0 else 0.0
    resolved_share = round(resolved_count / total_issues, 4) if total_issues > 0 else 0.0

    # Combine verification stats into 1 query
    verif_stats = db.query(
        func.count(Verification.id).label("total"),
        func.count(Verification.id).filter(Verification.fixed == True).label("fixed_cnt"),  # noqa: E712
    ).first()

    total_verif = verif_stats.total if verif_stats else 0
    fixed_verif = verif_stats.fixed_cnt if verif_stats else 0
    verified_fix_rate = round(fixed_verif / total_verif, 4) if total_verif > 0 else 0.0

    resolved_issues = db.query(Issue.created_at, Issue.resolved_at).filter(Issue.resolved_at.isnot(None)).all()
    if resolved_issues:
        total_days = sum(
            (r_at - c_at).total_seconds() / 86400.0
            for c_at, r_at in resolved_issues
            if c_at and r_at
        )
        avg_days_to_resolve = round(total_days / len(resolved_issues), 2)
    else:
        avg_days_to_resolve = 0.0

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
