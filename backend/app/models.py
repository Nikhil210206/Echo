import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    admin = "admin"
    staff = "staff"


class FeedbackKind(str, enum.Enum):
    text = "text"
    me_too = "me_too"


class FeedbackStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class IssueStatus(str, enum.Enum):
    open = "open"
    acknowledged = "acknowledged"
    in_progress = "in_progress"
    resolved = "resolved"
    reopened = "reopened"


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    team: Mapped[str | None] = mapped_column(String, nullable=True)
    assigned_issues: Mapped[list["Issue"]] = relationship(back_populates="assignee")


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    zone: Mapped[str | None] = mapped_column(String, nullable=True)
    feedback: Mapped[list["Feedback"]] = relationship(back_populates="location")
    issues: Mapped[list["Issue"]] = relationship(back_populates="location")


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    kind: Mapped[FeedbackKind] = mapped_column(SAEnum(FeedbackKind), default=FeedbackKind.text)
    text_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    tracking_code: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    device_hash: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Optional contact details the reporter chose to leave; kept out of the text and shown to admins only
    reporter_name: Mapped[str | None] = mapped_column(String, nullable=True)
    reporter_phone: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[FeedbackStatus] = mapped_column(SAEnum(FeedbackStatus), default=FeedbackStatus.pending)
    overall_sentiment: Mapped[str | None] = mapped_column(String, nullable=True)
    analyzed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    flags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    location: Mapped["Location"] = relationship(back_populates="feedback")
    aspects: Mapped[list["Aspect"]] = relationship(back_populates="feedback", cascade="all, delete-orphan")


class Aspect(Base):
    __tablename__ = "aspects"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    feedback_id: Mapped[str] = mapped_column(ForeignKey("feedback.id"), nullable=False)
    aspect: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False, index=True)
    sentiment: Mapped[str] = mapped_column(String, nullable=False)
    urgency: Mapped[str] = mapped_column(String, nullable=False)
    evidence_span: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    issue_id: Mapped[str | None] = mapped_column(ForeignKey("issues.id"), nullable=True, index=True)
    corrected_by_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    feedback: Mapped["Feedback"] = relationship(back_populates="aspects")
    issue: Mapped["Issue | None"] = relationship(back_populates="aspects")


class Issue(Base):
    __tablename__ = "issues"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    title: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False, index=True)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    status: Mapped[IssueStatus] = mapped_column(SAEnum(IssueStatus), default=IssueStatus.open)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    centroid: Mapped[list | None] = mapped_column(JSON, nullable=True)
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    public_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    reopened_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location: Mapped["Location"] = relationship(back_populates="issues")
    assignee: Mapped["User | None"] = relationship(back_populates="assigned_issues")
    aspects: Mapped[list["Aspect"]] = relationship(back_populates="issue")
    events: Mapped[list["IssueEvent"]] = relationship(back_populates="issue", cascade="all, delete-orphan")
    verifications: Mapped[list["Verification"]] = relationship(back_populates="issue", cascade="all, delete-orphan")


class IssueEvent(Base):
    __tablename__ = "issue_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id"), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String, nullable=True)
    to_status: Mapped[str] = mapped_column(String, nullable=False)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    issue: Mapped["Issue"] = relationship(back_populates="events")


class Verification(Base):
    __tablename__ = "verifications"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id"), nullable=False)
    tracking_code: Mapped[str] = mapped_column(String, nullable=False, index=True)
    fixed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    issue: Mapped["Issue"] = relationship(back_populates="verifications")
