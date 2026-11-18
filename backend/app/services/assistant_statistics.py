"""Server-owned count facts with fixed dates and authenticated visibility."""
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from hashlib import sha256
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Issue, UserRole
from app.services.retrieval import Access, SearchFilters, feedback_statistics, issue_scope


class StatisticsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric: Literal["approved_feedback_count"] = "approved_feedback_count"
    filters: SearchFilters = Field(default_factory=SearchFilters)


class StatisticsFact(BaseModel):
    fact_id: str
    request: StatisticsRequest
    scope: Literal["campus", "assigned_issues"]
    scope_key: str = Field(exclude=True)
    start_at: datetime | None
    end_before: datetime
    observed_at: datetime
    total: int
    by_overall_sentiment: dict[str, int]

    def stored(self) -> dict:
        return {**self.model_dump(mode="json"), "scope_key": self.scope_key}


@dataclass(frozen=True)
class StatisticsQuery:
    request: StatisticsRequest
    observed_at: datetime

    @property
    def window(self) -> tuple[datetime | None, datetime]:
        filters = self.request.filters
        start, end = None, self.observed_at
        if filters.days:
            start = end - timedelta(days=filters.days)
        if filters.date_from:
            start = datetime.combine(filters.date_from, time.min, timezone.utc)
        if filters.date_to:
            end = min(end, datetime.combine(filters.date_to + timedelta(days=1), time.min, timezone.utc))
        return start, end


def statistics_scope_key(db: Session, user: Access) -> str:
    digest = sha256(f"{user.role.value}\0{user.id}\0".encode())
    if user.role == UserRole.staff:
        for issue_id in db.scalars(select(Issue.id).where(*issue_scope(user)).order_by(Issue.id)):
            digest.update(issue_id.encode() + b"\0")
    return digest.hexdigest()


def collect_statistic(db: Session, user: Access, query: StatisticsQuery) -> StatisticsFact:
    start, end = query.window
    scope = "assigned_issues" if user.role == UserRole.staff else "campus"
    scope_key = statistics_scope_key(db, user)
    counts = feedback_statistics(db, user, query.request.filters, window=query.window)
    return StatisticsFact(
        fact_id=str(uuid4()),
        request=query.request,
        scope=scope,
        scope_key=scope_key,
        start_at=start,
        end_before=end,
        observed_at=query.observed_at,
        total=sum(counts.values()),
        by_overall_sentiment=counts,
    )


def statistic_is_current(db: Session, user: Access, fact: StatisticsFact, scope_key: str) -> bool:
    query = StatisticsQuery(fact.request, fact.observed_at)
    scope = "assigned_issues" if user.role == UserRole.staff else "campus"
    if fact.scope != scope or fact.scope_key != scope_key or (fact.start_at, fact.end_before) != query.window:
        return False

    counts = feedback_statistics(db, user, fact.request.filters, window=query.window)
    return counts == fact.by_overall_sentiment and sum(counts.values()) == fact.total
