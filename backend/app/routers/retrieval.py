"""Authenticated feedback search and citation views."""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import SessionLocal
from app.errors import AppError
from app.models import User
from app.services.feedback_index import EmbeddingUnavailable
from app.services.retrieval import Access, FeedbackHit, SearchFilters, SearchText, feedback_detail, limit_statement_time, search_records

router = APIRouter(prefix="/api/feedback", tags=["feedback search"])
logger = logging.getLogger(__name__)


def get_retrieval_db():
    # A transaction scopes query timeouts, including on GET.
    with SessionLocal() as db:
        yield db


def get_retrieval_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_retrieval_db)):
    # Use the current database role for evidence access even if the legacy auth cache is still warm.
    role = db.scalar(select(User.role).where(User.id == current_user.id))
    if role is None:
        raise AppError("UNAUTHORIZED", "User not found", status_code=401)
    return Access(current_user.id, role)


class SemanticQuery(SearchFilters):
    q: SearchText
    days: int | None = Field(None, ge=1, le=3650)
    limit: int = Field(20, ge=1, le=50)


@router.get("/semantic", response_model=list[FeedbackHit])
def semantic_feedback(
    query: Annotated[SemanticQuery, Query()],
    db: Session = Depends(get_retrieval_db),
    user: Access = Depends(get_retrieval_user),
):
    try:
        limit_statement_time(db)
        return search_records(db, user, query.q, query, query.limit)
    except (EmbeddingUnavailable, OperationalError) as exc:
        logger.warning("semantic_search_unavailable error_type=%s", type(exc).__name__)
        raise AppError("SEARCH_UNAVAILABLE", "Semantic search is temporarily unavailable. Try again or use keyword search.",
                       status_code=503) from None


@router.get("/sources/{record_id}")
def feedback_source(
    record_id: str,
    db: Session = Depends(get_retrieval_db),
    user: Access = Depends(get_retrieval_user),
):
    limit_statement_time(db)
    result = feedback_detail(db, user, record_id)
    if result is None:
        raise AppError("NOT_FOUND", "Feedback source is unavailable", status_code=404)
    return result
