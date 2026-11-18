"""Populate or rebuild the feedback search index independently of API startup."""
import argparse

from sqlalchemy import func, or_, select
from sqlalchemy.orm import undefer

from app.db import SessionLocal
from app.models import Feedback, FeedbackKind, FeedbackStatus
from app.services.feedback_index import MODEL_VERSION, update_feedback_embedding


def backfill(batch_size: int = 16, force: bool = False) -> int:
    last_id = ""
    indexed = 0
    with SessionLocal() as db:
        while True:
            query = (
                select(Feedback).options(undefer(Feedback.search_embedding_key))
                .where(
                    Feedback.id > last_id,
                    Feedback.status == FeedbackStatus.approved,
                    Feedback.kind == FeedbackKind.text,
                    func.trim(Feedback.text_redacted) != "",
                )
                .order_by(Feedback.id).limit(batch_size).with_for_update()
            )
            if not force:
                query = query.where(or_(
                    Feedback.search_embedding.is_(None),
                    Feedback.search_embedding_key.is_(None),
                    ~Feedback.search_embedding_key.startswith(MODEL_VERSION + ":"),
                ))
            batch = db.scalars(query).all()
            if not batch:
                return indexed
            last_id = batch[-1].id
            indexed += sum(update_feedback_embedding(row, strict=True, force=force) for row in batch)
            db.commit()
            print(f"Indexed {indexed} feedback records", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, choices=range(1, 101), default=16, metavar="1-100")
    parser.add_argument("--force", action="store_true", help="Recompute vectors already using the current model")
    args = parser.parse_args()
    print(f"Finished. Indexed {backfill(args.batch_size, args.force)} feedback records.")
