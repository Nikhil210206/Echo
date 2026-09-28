"""Re-checks already-approved feedback against the sarcasm and joke rules added after it was submitted.

Matching feedback goes back to the moderation queue, exactly as if it had just been submitted: its labels
are corrected (mocking praise is negative, a joke is neutral and not urgent), it leaves any issue it joined,
and issues left with no reports that nobody has worked on yet are removed.

Feedback an admin already approved from the moderation queue is left alone.

    python -m app.recheck           # show what would change
    python -m app.recheck --apply   # change it
"""
import argparse

from sqlalchemy.orm import joinedload

from app.db import SessionLocal
from app.models import Aspect, Feedback, FeedbackKind, FeedbackStatus, Issue, IssueEvent, IssueStatus
from app.services.lifecycle import rescore_issues, unlink_feedback
from app.services.moderation import check_joke, check_sarcasm

# Flags that only mark a cleanup, not a reason to hold feedback back
CLEANUP_FLAGS = {"profanity_masked"}


def overall_sentiment(aspects) -> str:
    negative = sum(1 for a in aspects if a.sentiment == "negative")
    positive = sum(1 for a in aspects if a.sentiment == "positive")
    return "negative" if negative > positive else "positive" if positive > negative else "neutral"


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        candidates = (
            db.query(Feedback)
            .options(joinedload(Feedback.aspects), joinedload(Feedback.location))
            .filter(
                Feedback.kind == FeedbackKind.text,
                Feedback.status == FeedbackStatus.approved,
                Feedback.text_redacted.isnot(None),
            )
            .all()
        )

        touched_issue_ids = set()
        changed = 0
        for fb in candidates:
            if set(fb.flags or []) - CLEANUP_FLAGS:
                continue  # an admin already reviewed and approved it

            sarcastic = check_sarcasm(fb.text_redacted)
            joke = check_joke(fb.text_redacted)
            if not sarcastic and not joke:
                continue

            new_flags = [f for f, hit in (("sarcasm", sarcastic), ("off_topic", joke)) if hit]
            print(f"{fb.location.name if fb.location else '?'} · {fb.created_at:%Y-%m-%d %H:%M} · "
                  f"{', '.join(new_flags)} · {fb.text_redacted!r}")
            changed += 1
            if not apply:
                continue

            for a in fb.aspects:
                if check_sarcasm(a.evidence_span or "") or (sarcastic and a.sentiment == "positive"):
                    a.sentiment = "negative"
                elif check_joke(a.evidence_span or ""):
                    a.sentiment = "neutral"
                    a.urgency = "normal"
            fb.overall_sentiment = overall_sentiment(fb.aspects)
            fb.flags = list(fb.flags or []) + new_flags
            fb.status = FeedbackStatus.pending
            touched_issue_ids |= unlink_feedback(db, fb)

        if not apply:
            print(f"\n{changed} feedback would go back to moderation. Run with --apply to do it.")
            return

        rescore_issues(db, touched_issue_ids)

        # An issue opened only by feedback that's now held back has no reports left. Remove it,
        # unless staff have already acted on it (status change, response, assignee or history).
        removed = []
        for issue in db.query(Issue).filter(Issue.id.in_(touched_issue_ids)).all():
            has_reports = db.query(Aspect.id).filter(Aspect.issue_id == issue.id).first()
            has_history = db.query(IssueEvent.id).filter(IssueEvent.issue_id == issue.id).first()
            untouched = (
                issue.status == IssueStatus.open
                and not issue.public_response
                and issue.assignee_id is None
                and not has_history
            )
            if not has_reports and untouched:
                removed.append(issue.title)
                db.delete(issue)

        db.commit()
        print(f"\n{changed} feedback moved back to moderation.")
        for title in removed:
            print(f"Removed empty issue: {title}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="make the changes (default: only show them)")
    main(parser.parse_args().apply)
