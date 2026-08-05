from datetime import datetime

from sqlalchemy import JSON, Boolean, String, Text, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, JSONType, utcnow

BLOCKED_REVIEW_STATUSES = ("rejected", "revoked")


class Namespace(Base):
    __tablename__ = "namespaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    reserved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    members: Mapped[list["NamespaceMember"]] = relationship(back_populates="namespace", cascade="all, delete-orphan")


class NamespaceMember(Base):
    __tablename__ = "namespace_members"
    __table_args__ = (UniqueConstraint("namespace_id", "user_id", name="uq_namespace_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    namespace_id: Mapped[int] = mapped_column(ForeignKey("namespaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="maintainer")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    namespace: Mapped[Namespace] = relationship(back_populates="members")


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (UniqueConstraint("namespace", "name", name="uq_agents_ns_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    namespace: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    author: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    license: Mapped[str] = mapped_column(String(64), default="")
    framework: Mapped[str | None] = mapped_column(String(64), nullable=True)
    models: Mapped[list] = mapped_column(JSONType, default=list)
    tags: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    versions: Mapped[list["AgentVersion"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan", order_by="AgentVersion.published_at.desc()"
    )


class AgentVersion(Base):
    __tablename__ = "agent_versions"
    __table_args__ = (UniqueConstraint("agent_id", "version", name="uq_versions_agent_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(64))
    manifest: Mapped[dict] = mapped_column(JSONType)
    sha256: Mapped[str] = mapped_column(String(64))
    archive_name: Mapped[str] = mapped_column(String(255))
    signature: Mapped[dict] = mapped_column(JSONType)
    published_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    published_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    download_count: Mapped[int] = mapped_column(default=0)
    security_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    security_findings: Mapped[list] = mapped_column(JSONType, default=list)
    yanked: Mapped[bool] = mapped_column(Boolean, default=False)
    review_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    scan_requested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    scan_completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    agent: Mapped[Agent] = relationship(back_populates="versions")
    reviews: Mapped[list["VersionReviewEvent"]] = relationship(
        back_populates="version", cascade="all, delete-orphan", order_by="VersionReviewEvent.created_at"
    )


class VersionReviewEvent(Base):
    __tablename__ = "version_review_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("agent_versions.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    digest: Mapped[str] = mapped_column(String(64))
    signer_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    version: Mapped[AgentVersion] = relationship(back_populates="reviews")
