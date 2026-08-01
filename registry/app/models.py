from datetime import datetime, timezone

from sqlalchemy import JSON, String, Text, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db import Base


class JSONType(TypeDecorator):
    """JSON that maps to JSONB on Postgres and JSON/Text on SQLite."""

    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    github_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    keys: Mapped[list["SigningKey"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class SigningKey(Base):
    __tablename__ = "signing_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    public_key_pem: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship(back_populates="keys")


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

    agent: Mapped[Agent] = relationship(back_populates="versions")
