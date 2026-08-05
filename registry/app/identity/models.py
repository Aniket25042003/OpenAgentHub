from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    github_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(16), default="publisher")
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    tos_version: Mapped[int] = mapped_column(Integer, default=0)
    privacy_version: Mapped[int] = mapped_column(Integer, default=0)
    publisher_agreement_version: Mapped[int] = mapped_column(Integer, default=0)

    keys: Mapped[list["SigningKey"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserAgreement(Base):
    """Accepted ToS/privacy/publisher-agreement versions with timestamps."""

    __tablename__ = "user_agreements"
    __table_args__ = (UniqueConstraint("user_id", "term_name", name="uq_user_agreement"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    term_name: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer, default=1)
    accepted_at: Mapped[datetime] = mapped_column(default=utcnow)


class Session(Base):
    """Server-side opaque browser/CLI session with rotation and revocation.

    Sessions are identified by an opaque random token; only its hash is stored.
    Expiration is both absolute (``expires_at``) and idle (``idle_expires_at``).
    ``context`` records device/creation metadata for the sessions page.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    audience: Mapped[str] = mapped_column(String(16), default="web")  # web | cli
    device_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(default=utcnow)
    idle_expires_at: Mapped[datetime] = mapped_column(default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    rotated_from_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id"), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class SigningKey(Base):
    __tablename__ = "signing_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    public_key_pem: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship(back_populates="keys")


class LoginTransaction(Base):
    """One-time browser/device authorization flow.

    The CLI requests a transaction, the user approves it in the already-open web
    session, and the CLI polls for a credential bound to that transaction. Fields
    are hashed wherever they act as bearer capabilities.
    """

    __tablename__ = "login_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    nonce: Mapped[str] = mapped_column(String(64))
    client_name: Mapped[str] = mapped_column(String(64), default="cli")
    redirect_mode: Mapped[str] = mapped_column(String(8), default="poll")
    requested_scopes: Mapped[str] = mapped_column(String(255), default="cli")
    registry_origin: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)