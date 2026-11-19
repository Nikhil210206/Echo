"""Private assistant conversations with bounded history and idempotent turns."""
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import AssistantConversation as Conversation, AssistantMessage as Message
from app.routers.retrieval import get_retrieval_db, get_retrieval_user
from app.services.assistant import answer_question, authorized_results
from app.services.assistant_provider import configured_provider
from app.services.assistant_statistics import StatisticsRequest
from app.services.redact import redact_pii
from app.services.retrieval import Access, SearchText, limit_statement_time

router = APIRouter(prefix="/api/assistant", tags=["assistant"])
HISTORY_TURNS = 20
CONTEXT_TURNS = 4


class NewMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: SearchText
    request_id: UUID
    statistics: StatisticsRequest | None = None


def _owned(db: Session, user: Access, conversation_id: str) -> Conversation:
    conversation = db.scalar(select(Conversation).where(
        Conversation.id == conversation_id, Conversation.owner_id == user.id
    ))
    if conversation is None:
        raise AppError("NOT_FOUND", "Conversation not found", status_code=404)
    return conversation


def _summary(conversation: Conversation) -> dict:
    return {"id": conversation.id, "title": conversation.title, "updated_at": conversation.updated_at}


def _history(db: Session, user: Access, conversation_id: str, after: int) -> list[dict]:
    records = db.scalars(
        select(Message).where(Message.conversation_id == conversation_id, Message.turn > after)
        .order_by(Message.turn, Message.role.desc())
    ).all()
    results = iter(authorized_results(db, user, [row.result for row in records if row.role == "assistant"]))
    return [
        {"turn": row.turn, "role": row.role, "text": row.content, "statistics": row.result}
        if row.role == "user"
        else {"turn": row.turn, "role": row.role, "result": next(results).model_dump(mode="json")}
        for row in records
    ]


def _provider_history(messages: list[dict]) -> list[dict]:
    history = []
    for message in messages:
        if message["role"] == "user":
            history.append({"role": "user", "content": message["text"]})
        else:
            result = message["result"]
            context = {
                "previous_sources": [
                    {"source_id": source["source_id"], "title": source["title"],
                     "linked_issues": source["facts"].get("issues", [])}
                    for source in result["sources"][:5]
                ],
                "previous_count_request": result["statistic"]["request"] if result["statistic"] else None,
            }
            history.append({"role": "assistant", "content": json.dumps(context)})
    return history


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_retrieval_db), user: Access = Depends(get_retrieval_user)):
    rows = db.scalars(select(Conversation).where(Conversation.owner_id == user.id)
                     .order_by(Conversation.updated_at.desc(), Conversation.id).limit(40))
    return {"items": [_summary(row) for row in rows],
            "mode": "grounded" if configured_provider() else "retrieval_only"}


@router.put("/conversations/{conversation_id}")
def create_conversation(conversation_id: UUID, db: Session = Depends(get_retrieval_db),
                        user: Access = Depends(get_retrieval_user)):
    key = str(conversation_id)
    row = db.get(Conversation, key)
    if row is None:
        row = Conversation(id=key, owner_id=user.id, title="New conversation", updated_at=datetime.now(timezone.utc))
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = _owned(db, user, key)
    if row.owner_id != user.id:
        raise AppError("NOT_FOUND", "Conversation not found", status_code=404)
    return _summary(row)


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: UUID, db: Session = Depends(get_retrieval_db),
                     user: Access = Depends(get_retrieval_user)):
    limit_statement_time(db)
    row = _owned(db, user, str(conversation_id))
    return {**_summary(row), "messages": _history(db, user, row.id, row.turn_count - HISTORY_TURNS)}


def _existing_turn(db: Session, user: Access, row: Conversation, key: str, question: str, statistics: dict | None):
    message = db.scalar(select(Message).where(Message.conversation_id == row.id, Message.request_id == key))
    if message is None:
        return None
    if message.content != question or message.result != statistics:
        raise AppError("TURN_CONFLICT", "Request ID already used for a different request", status_code=409)
    return {**_summary(row), "messages": _history(db, user, row.id, row.turn_count - HISTORY_TURNS)}


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: UUID, payload: NewMessage, db: Session = Depends(get_retrieval_db),
                 user: Access = Depends(get_retrieval_user)):
    limit_statement_time(db)
    conversation_id = str(conversation_id)
    key = str(payload.request_id)
    question = redact_pii(payload.question)
    statistics = payload.statistics.model_dump(mode="json") if payload.statistics else None
    row = _owned(db, user, conversation_id)
    existing = _existing_turn(db, user, row, key, question, statistics)
    if existing:
        return existing

    previous_turn = row.turn_count
    title = row.title if previous_turn else " ".join(question.split())[:96]
    history = _provider_history(_history(db, user, row.id, previous_turn - CONTEXT_TURNS))
    db.rollback()  # Release the connection while the provider works.

    result = answer_question(db, user, question, history, configured_provider(), payload.statistics)
    limit_statement_time(db)
    turn = previous_turn + 1
    saved = db.execute(
        update(Conversation).where(
            Conversation.id == conversation_id, Conversation.owner_id == user.id, Conversation.turn_count == previous_turn
        ).values(turn_count=turn, title=title, updated_at=datetime.now(timezone.utc))
    ).rowcount
    if not saved:
        db.rollback()
        row = _owned(db, user, conversation_id)
        existing = _existing_turn(db, user, row, key, question, statistics)
        if existing:
            return existing
        raise AppError("TURN_CONFLICT", "Another message was saved first. Retry to continue the conversation.", status_code=409)

    db.add_all([
        Message(conversation_id=conversation_id, turn=turn, role="user", content=question, request_id=key, result=statistics),
        Message(conversation_id=conversation_id, turn=turn, role="assistant", content="", result=result.stored(user)),
    ])
    db.execute(delete(Message).where(Message.conversation_id == conversation_id, Message.turn <= turn - HISTORY_TURNS))
    db.commit()
    return get_conversation(UUID(conversation_id), db, user)
