"""Scoped search and recorded evidence for the admin console and assistant."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import logging
from time import monotonic
from typing import Annotated, Literal

from pgvector.sqlalchemy import Vector
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import Float, bindparam, case, cast, func, null, or_, select, text
from sqlalchemy.orm import Session

from app.models import Aspect, Feedback, FeedbackKind, FeedbackStatus, Issue, IssueStatus, Location, UserRole
from app.schemas import AspectResult
from app.services.feedback_index import DIMENSIONS, MODEL_VERSION, embed_with_timeout
from app.services.lifecycle import issue_priority_summary
from app.services.priority import URGENCY_MAP
from app.services.redact import redact_pii

logger = logging.getLogger(__name__)
Category = AspectResult.model_fields["category"].annotation
Sentiment = Literal["positive", "negative", "neutral"]
SearchText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category | None = None
    sentiment: Sentiment | None = None
    location: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = Field(
        None, description="Exact campus location name, slug, or ID"
    )
    days: Annotated[int, Field(strict=True, ge=1, le=3650)] | None = Field(None, description="Rolling days back from now")
    date_from: date | None = Field(None, description="First UTC calendar date, inclusive")
    date_to: date | None = Field(None, description="Last UTC calendar date, inclusive")
    issue_status: IssueStatus | Literal["active"] | None = Field(None, description="Active means any unresolved status")

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.days and (self.date_from or self.date_to):
            raise ValueError("Use rolling days or calendar dates")
        if self.date_to == date.max or (self.date_from and self.date_to and self.date_from > self.date_to):
            raise ValueError("Invalid date range")
        return self


class LinkedIssue(BaseModel):
    id: str
    status: IssueStatus


@dataclass(frozen=True)
class Access:
    id: str
    role: UserRole


class FeedbackHit(BaseModel):
    id: str
    excerpt: str
    location_name: str
    created_at: datetime
    sentiment: str | None
    issues: list[LinkedIssue]
    similarity: float | None


def limit_statement_time(db: Session):
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET LOCAL statement_timeout = '2500ms'"))


def issue_scope(user):
    if user.role == UserRole.staff:
        return (Issue.assignee_id == user.id,)
    return ()


def matching_aspects(user, filters: SearchFilters):
    query = select(Aspect.feedback_id)
    if filters.category:
        query = query.where(Aspect.category == filters.category)
    if filters.sentiment:
        query = query.where(Aspect.sentiment == filters.sentiment)
    if filters.issue_status or user.role == UserRole.staff:
        query = query.join(Issue, Issue.id == Aspect.issue_id).where(*issue_scope(user))
        if filters.issue_status == "active":
            query = query.where(Issue.status != IssueStatus.resolved)
        elif filters.issue_status:
            query = query.where(Issue.status == filters.issue_status)
    return query


def feedback_conditions(user, filters: SearchFilters, *, window: tuple[datetime | None, datetime] | None = None):
    conditions = [Feedback.status == FeedbackStatus.approved]
    if filters.location:
        location = filters.location.lower()
        conditions.append(or_(Feedback.location_id == filters.location, func.lower(Location.slug) == location,
                              func.lower(Location.name) == location))
    if window is not None:
        start, end = window
        if start is not None:
            conditions.append(Feedback.created_at >= start)
        conditions.append(Feedback.created_at < end)
    elif filters.days:
        conditions.append(Feedback.created_at >= datetime.now(timezone.utc) - timedelta(days=filters.days))
    else:
        if filters.date_from:
            conditions.append(Feedback.created_at >= datetime.combine(filters.date_from, time.min, timezone.utc))
        if filters.date_to:
            end = datetime.combine(filters.date_to + timedelta(days=1), time.min, timezone.utc)
            conditions.append(Feedback.created_at < end)
    if filters.category or filters.sentiment or filters.issue_status or user.role == UserRole.staff:
        conditions.append(Feedback.id.in_(matching_aspects(user, filters)))
    return conditions


def _with_issues(db: Session, user, rows) -> list[FeedbackHit]:
    if not rows:
        return []
    issue_rows = db.execute(
        select(Aspect.feedback_id, Issue.id, Issue.status)
        .join(Issue, Issue.id == Aspect.issue_id)
        .where(Aspect.feedback_id.in_([row.id for row in rows]), *issue_scope(user))
        .distinct().order_by(Aspect.feedback_id, Issue.id)
    )
    issues: dict[str, list[LinkedIssue]] = {}
    for record_id, issue_id, status in issue_rows:
        links = issues.setdefault(record_id, [])
        if len(links) < 5:
            links.append(LinkedIssue(id=issue_id, status=status))
    return [
        FeedbackHit(
            id=row.id,
            excerpt=redact_pii(row.text_redacted)[:420],
            location_name=row.name,
            created_at=row.created_at,
            sentiment=row.overall_sentiment,
            issues=issues.get(row.id, []),
            similarity=round(max(-1.0, min(1.0, 1 - row.distance)), 6) if row.distance is not None else None,
        )
        for row in rows
    ]


def _text_feedback():
    return (
        select(Feedback.id, Feedback.text_redacted, Location.name, Feedback.created_at, Feedback.overall_sentiment)
        .join(Location, Location.id == Feedback.location_id)
        .where(Feedback.kind == FeedbackKind.text, func.trim(Feedback.text_redacted) != "")
    )


def search_records(
    db: Session,
    user,
    query: str,
    filters: SearchFilters,
    limit: int = 5,
    *,
    semantic: bool = True,
    embedding_timeout: float = 4,
    minimum_similarity: float | None = None,
    keywords: list[str] | None = None,
) -> list[FeedbackHit]:
    started = monotonic()
    statement = _text_feedback().where(*feedback_conditions(user, filters))
    if semantic:
        vector = embed_with_timeout(query, timeout=embedding_timeout)
        if db.get_bind().dialect.name == "sqlite":
            # Only used by the offline fixture with a registered exact cosine function.
            distance = func.echo_cosine_distance(Feedback.search_embedding, bindparam("vector", vector, type_=Feedback.__table__.c.search_embedding.type))
        else:
            distance = Feedback.search_embedding.op("<=>", return_type=Float)(
                bindparam("vector", vector, type_=Vector(DIMENSIONS))
            )
        statement = statement.where(
            Feedback.search_embedding.is_not(None), Feedback.search_embedding_key.startswith(MODEL_VERSION + ":")
        ).order_by(distance)
        if minimum_similarity is not None:
            statement = statement.where(distance <= 1 - minimum_similarity)
    else:
        distance = cast(null(), Float)
        statement = statement.where(or_(*[
            Feedback.text_redacted.icontains(term, autoescape=True) for term in (keywords or [query])
        ]))

    rows = db.execute(
        statement.add_columns(distance.label("distance"))
        .order_by(Feedback.created_at.desc(), Feedback.id).limit(limit)
    ).all()
    result = _with_issues(db, user, rows)
    logger.info("feedback_retrieval mode=%s matches=%d latency_ms=%.1f",
                "semantic" if semantic else "keyword", len(result), (monotonic() - started) * 1000)
    return result


def feedback_detail(db: Session, user, record_id: str) -> dict | None:
    row = db.execute(
        _text_feedback().add_columns(cast(null(), Float).label("distance"))
        .where(Feedback.id == record_id, *feedback_conditions(user, SearchFilters()))
    ).one_or_none()
    if row is None:
        return None
    return {**_with_issues(db, user, [row])[0].model_dump(mode="json"), "text": redact_pii(row.text_redacted)}


def issue_details(db: Session, user, issue_id: str) -> dict | None:
    row = db.execute(
        select(Issue.id, Issue.category, Issue.status, Issue.resolved_at, Issue.reopened_count, Location.name)
        .join(Location).where(Issue.id == issue_id, *issue_scope(user)).limit(1)
    ).one_or_none()
    if row is None:
        return None
    # Collapse aspects within PostgreSQL and transfer one aggregate row, regardless of issue size.
    reports = (
        select(
            Feedback.created_at.label("created_at"),
            func.max(case((Aspect.sentiment == "negative", 1), else_=0)).label("negative"),
            func.max(case(URGENCY_MAP, value=func.lower(Aspect.urgency), else_=1)).label("urgency"),
        )
        .select_from(Aspect)
        .join(Feedback).join(Issue, Aspect.issue_id == Issue.id)
        .where(Aspect.issue_id == issue_id, Feedback.status == FeedbackStatus.approved, *issue_scope(user))
        .group_by(Feedback.id, Feedback.created_at).subquery()
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    total, recent, negative, urgency = db.execute(
        select(
            func.count(),
            func.count().filter(reports.c.created_at >= cutoff),
            func.coalesce(func.sum(reports.c.negative), 0),
            func.coalesce(func.max(reports.c.urgency), 1),
        ).select_from(reports)
    ).one()
    return {
        "id": row.id, "category": row.category, "location_name": row.name,
        "status": row.status.value, "reopened_count": row.reopened_count,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "report_count": total,
        "priority": issue_priority_summary(total, recent, negative, urgency),
    }


def feedback_statistics(db: Session, user, filters: SearchFilters, *, window: tuple[datetime | None, datetime]) -> dict[str, int]:
    sentiment = case(
        (Feedback.overall_sentiment.in_(("negative", "neutral", "positive")), Feedback.overall_sentiment),
        else_="unknown",
    )
    rows = db.execute(
        select(sentiment, func.count())
        .join(Location, Location.id == Feedback.location_id)
        .where(*feedback_conditions(user, filters, window=window)).group_by(sentiment)
    )
    counts = dict.fromkeys(("negative", "neutral", "positive", "unknown"), 0)
    for label, count in rows:
        counts[label] = count
    return counts
