"""Compare keyword substring and exact semantic retrieval on a fixed synthetic corpus."""
import argparse
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from importlib.metadata import version
from math import log2
import os
from pathlib import Path
from statistics import mean, median
from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

# The evaluation uses its own in-memory engine. The application engine is never opened.
os.environ.setdefault("DATABASE_URL", "sqlite:///unused-evaluation.db")

from app.db import Base
from app.models import Aspect, Feedback, FeedbackKind, Issue, Location, User, UserRole
from app.services.cluster import EMBEDDING_MODEL, cosine_similarity, get_embedding_model
from app.services.feedback_index import MODEL_VERSION, update_feedback_embedding
from app.services.retrieval import Access, SearchFilters, search_records

DATA = Path(__file__).with_name("retrieval_cases.json")
K = 5


@contextmanager
def synthetic_database(dataset, *, with_vectors=True):
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def register_cosine(connection, _):
        connection.create_function("echo_cosine_distance", 2, lambda a, b: (
            1 - cosine_similarity(json.loads(a), json.loads(b)) if a and b else None
        ))

    try:
        Base.metadata.create_all(engine)
        with Session(engine, expire_on_commit=False) as db:
            db.add_all([Location(id=key, slug=key, name=name) for key, name in dataset["locations"].items()])
            db.add_all([User(id=role, name=role, email=f"{role}@example.invalid", password_hash="unused",
                             role=UserRole.admin if role == "admin" else UserRole.staff)
                       for role in ("admin", "staff", "other")])
            db.flush()
            db.add_all([Issue(id=row["id"], category=row["category"], title=row["category"], status=row["status"],
                              location_id=row["location"], assignee_id=row["assignee"]) for row in dataset["issues"]])
            db.flush()
            for row in dataset["corpus"]:
                record = Feedback(id=row["id"], text_redacted=row["text"], kind=FeedbackKind.text,
                                  status=row.get("status", "approved"), location_id=row["location"],
                                  tracking_code=row["id"], overall_sentiment=row["sentiment"],
                                  created_at=datetime.fromisoformat(row["date"]).replace(tzinfo=timezone.utc))
                if with_vectors:
                    update_feedback_embedding(record, strict=True)
                db.add(record)
                db.add(Aspect(feedback_id=row["id"], category=row["category"], aspect=row["category"],
                              sentiment=row["sentiment"], urgency="normal", issue_id=row["issue"]))
            db.commit()
            yield db
    finally:
        engine.dispose()


def rank_metrics(ranked, relevance):
    def dcg(grades):
        return sum((2 ** grade - 1) / log2(rank + 1) for rank, grade in enumerate(grades, 1))

    grades = [relevance.get(item, 0) for item in ranked[:K]]
    relevant = [index for index, grade in enumerate(grades, 1) if grade > 0]
    best = dcg(sorted(relevance.values(), reverse=True)[:K])
    return {"recall@5": len(relevant) / len(relevance), "mrr@5": 1 / relevant[0] if relevant else 0,
            "ndcg@5": dcg(grades) / best}


def evaluate(db, queries, semantic):
    rows = []
    times = []
    empty = []
    judgments = []
    user = Access("admin", UserRole.admin)
    for case in queries:
        started = perf_counter()
        hits = search_records(db, user, case["query"], SearchFilters.model_validate(case["filters"]),
                              limit=K, semantic=semantic)
        times.append((perf_counter() - started) * 1000)
        ranked = [hit.id for hit in hits]
        rows.append({"id": case["id"], "ranked": ranked})
        if case["relevance"]:
            judgments.append(rank_metrics(ranked, case["relevance"]))
        else:
            empty.append(not ranked)
    return {
        "macro_metrics": {key: round(mean(row[key] for row in judgments), 4)
                          for key in ("recall@5", "mrr@5", "ndcg@5")} if judgments else {},
        "empty_queries_returned_empty": f"{sum(empty)}/{len(empty)}",
        "queries_with_relevant_records": len(judgments),
        "local_fixture_query_p50_ms": round(median(times), 2),
        "rankings": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATA)
    parser.add_argument("--keyword-only", action="store_true", help="Run the substring baseline without loading MiniLM")
    args = parser.parse_args()
    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    if not args.keyword_only:
        get_embedding_model()
    with synthetic_database(dataset, with_vectors=not args.keyword_only) as db:
        print(json.dumps({
            "dataset": args.dataset.name,
            "version": dataset["version"],
            "records": len(dataset["corpus"]),
            "queries": len(dataset["queries"]),
            "model": EMBEDDING_MODEL,
            "embedding_version": MODEL_VERSION,
            "fastembed": version("fastembed"),
            "keyword": evaluate(db, dataset["queries"], False),
            "semantic": "not run" if args.keyword_only else evaluate(db, dataset["queries"], True),
        }, indent=2))


if __name__ == "__main__":
    main()
