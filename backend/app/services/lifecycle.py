"""Issue lifecycle: attaching feedback to issues, detaching it, rescoring, and resolution rounds.

Only approved feedback counts toward issues. Flagged feedback waits in moderation unlinked, gets
linked when an admin approves it, and is unlinked again if an admin rejects it.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.models import Aspect, Feedback, Issue, IssueStatus, Verification
from app.services.cluster import cluster_aspect, compute_updated_centroid
from app.services.priority import calculate_priority_score


def link_negative_aspects(db: Session, aspects: Iterable[Aspect], location_id: str) -> Set[str]:
    """Joins each unlinked negative aspect to a matching open issue at the location, or opens a new one.
    Returns the ids of the issues touched."""
    touched_issue_ids: Set[str] = set()

    for aspect in aspects:
        if aspect.sentiment != "negative" or aspect.issue_id is not None:
            continue

        open_db_issues = (
            db.query(Issue)
            .filter(
                Issue.location_id == location_id,
                Issue.category == aspect.category,
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
            aspect_text=aspect.evidence_span or aspect.aspect,
            aspect_category=aspect.category,
            aspect_location_id=location_id,
            open_issues=open_issues_dicts,
        )

        matched_issue = None
        if match_res.should_join and match_res.matched_issue_id:
            matched_issue = next((iss for iss in open_db_issues if iss.id == match_res.matched_issue_id), None)

        if matched_issue:
            existing_aspect_count = (
                db.query(func.count(Aspect.id)).filter(Aspect.issue_id == matched_issue.id).scalar() or 0
            )
            matched_issue.centroid = compute_updated_centroid(
                current_centroid=matched_issue.centroid or [],
                current_count=existing_aspect_count,
                new_embedding=match_res.embedding,
            )
            aspect.issue_id = matched_issue.id
        else:
            new_issue = Issue(
                title=f"{aspect.category.capitalize()}: {(aspect.evidence_span or aspect.aspect)[:50]}",
                category=aspect.category,
                location_id=location_id,
                status=IssueStatus.open,
                centroid=match_res.embedding,
                priority_score=0.0,
            )
            db.add(new_issue)
            db.flush()
            aspect.issue_id = new_issue.id

        touched_issue_ids.add(aspect.issue_id)
        # So the next aspect's cluster count sees this one
        db.flush()

    return touched_issue_ids


def unlink_feedback(db: Session, feedback: Feedback) -> Set[str]:
    """Detaches all of a feedback's aspects from their issues. Returns the ids of the issues touched."""
    touched_issue_ids = {a.issue_id for a in feedback.aspects if a.issue_id}
    for aspect in feedback.aspects:
        aspect.issue_id = None
    db.flush()
    return touched_issue_ids


def score_issue(aspects: List[Aspect], reference_time: Optional[datetime] = None) -> Dict[str, Any]:
    """Priority = Rw × N × U over the issue's reports (one per feedback; negative if it complains).
    The single formula behind both the stored priority_score and the breakdown on the issue page.
    Expects each aspect's feedback to be loaded."""
    reference_time = reference_time or datetime.now(timezone.utc)
    urgency_levels = {"normal": 1, "high": 2, "critical": 3}

    reports: Dict[str, Dict[str, Any]] = {}
    highest_urgency = "normal"
    for a in aspects:
        report = reports.setdefault(
            a.feedback_id, {"created_at": a.feedback.created_at if a.feedback else None, "sentiment": "neutral"}
        )
        if a.sentiment == "negative":
            report["sentiment"] = "negative"
        urgency = (a.urgency or "normal").lower()
        if urgency_levels.get(urgency, 1) > urgency_levels[highest_urgency]:
            highest_urgency = urgency

    if not reports:
        # calculate_priority_score treats an empty list as one report; an issue with none scores 0
        return {"recent_reports": 0, "older_reports": 0, "recency_weighted": 0.0, "negative_share": 0.0,
                "urgency_multiplier": 1, "score": 0.0}

    result = calculate_priority_score(list(reports.values()), highest_urgency=highest_urgency, reference_time=reference_time)
    seven_days_ago = reference_time - timedelta(days=7)
    recent_reports = sum(1 for r in reports.values() if r["created_at"] and _as_utc(r["created_at"]) >= seven_days_ago)

    return {
        "recent_reports": recent_reports,
        "older_reports": len(reports) - recent_reports,
        "recency_weighted": result.breakdown.recency_weighted_reports,
        "negative_share": result.breakdown.negative_share,
        "urgency_multiplier": int(result.breakdown.urgency_multiplier),
        "score": result.priority_score,
    }


def rescore_issues(db: Session, issue_ids: Iterable[str]) -> None:
    """Recomputes priority_score from each issue's currently linked reports, in two queries."""
    issue_ids = set(issue_ids)
    if not issue_ids:
        return
    db.flush()  # sessions don't autoflush; make pending link changes visible to the queries below

    aspects_by_issue: Dict[str, List[Aspect]] = {iss_id: [] for iss_id in issue_ids}
    linked = (
        db.query(Aspect)
        .options(defer(Aspect.embedding), joinedload(Aspect.feedback))
        .filter(Aspect.issue_id.in_(issue_ids))
        .all()
    )
    for a in linked:
        aspects_by_issue[a.issue_id].append(a)

    for issue in db.query(Issue).filter(Issue.id.in_(issue_ids)).all():
        issue.priority_score = score_issue(aspects_by_issue[issue.id])["score"]


def rescore_all_issues(db: Session) -> None:
    """Refreshes every issue's stored score. Recency weighting changes as reports age past a week,
    so stored scores (used for sorting and ranking) drift unless refreshed periodically."""
    rescore_issues(db, [iss_id for (iss_id,) in db.query(Issue.id).all()])


def current_round_votes(db: Session, issue: Issue) -> List[Verification]:
    """Verification votes on the issue's latest resolution. When a reopened issue is resolved again,
    earlier votes no longer count, so everyone can check the new fix."""
    query = db.query(Verification).filter(Verification.issue_id == issue.id)
    if issue.resolved_at is not None:
        query = query.filter(Verification.created_at >= issue.resolved_at)
    return query.all()


def reported_before_fix(feedback: Feedback, issue: Issue) -> bool:
    """Only reports filed before the fix was announced can vote on it. Otherwise anyone could mint
    new tracking codes (e.g. with "me too") after a fix and swing the vote."""
    resolved_at: Optional[datetime] = issue.resolved_at
    if resolved_at is None or feedback.created_at is None:
        return True
    return _as_utc(feedback.created_at) <= _as_utc(resolved_at)


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
