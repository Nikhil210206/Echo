"""Issue lifecycle: attaching feedback to issues, detaching it, rescoring, and resolution rounds.

Only approved feedback counts toward issues. Flagged feedback waits in moderation unlinked, gets
linked when an admin approves it, and is unlinked again if an admin rejects it.
"""
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

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


def rescore_issues(db: Session, issue_ids: Iterable[str]) -> None:
    """Recomputes priority_score from each issue's currently linked aspects."""
    urgency_levels = {"critical": 3, "high": 2, "normal": 1}

    for iss_id in issue_ids:
        target_issue = db.query(Issue).filter(Issue.id == iss_id).first()
        if not target_issue:
            continue

        linked_aspects = db.query(Aspect).filter(Aspect.issue_id == target_issue.id).all()
        if not linked_aspects:
            # Every report was rejected; calculate_priority_score would treat an empty list as one report
            target_issue.priority_score = 0.0
            continue

        reports_data = []
        highest_urgency = "normal"
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
