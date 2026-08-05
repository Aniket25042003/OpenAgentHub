from datetime import datetime

from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, JSONType, utcnow


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONType)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(nullable=True, index=True)


class QueueJob(Base):
    __tablename__ = "queue_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_type: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONType)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    dedupe_key: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    next_attempt_at: Mapped[datetime] = mapped_column(default=utcnow)
    leased_until: Mapped[datetime | None] = mapped_column(nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
