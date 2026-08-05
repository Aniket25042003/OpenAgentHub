"""Server-side sessions, agreements, and CLI browser/device login transactions.

Sessions are opaque random tokens (only the SHA-256 hash is stored), with
absolute and idle expiration, rotation, and server-side revocation. The hosted
web sets them as an ``HttpOnly`` cookie; the CLI stores its credential in the
encrypted vault. GitHub provider tokens never appear here — only the
OpenAgentHub session token derived after an approved transaction.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import Session, User
from app.identity.repositories import (
    LoginTransactionRepository,
    SessionRepository,
    UserAgreementRepository,
    UserRepository,
)


class SessionError(ValueError):
    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _session_ttls() -> tuple[int, int]:
    settings = get_settings()
    return settings.session_absolute_ttl_seconds, settings.session_idle_ttl_seconds


async def create_session(
    session: AsyncSession,
    user: User,
    *,
    audience: str = "web",
    device_label: str | None = None,
) -> tuple[str, Session]:
    absolute, idle = _session_ttls()
    now = datetime.now(timezone.utc)
    token = new_session_token()
    model = await SessionRepository(session).create(
        user_id=user.id,
        token_hash=hash_token(token),
        audience=audience,
        device_label=device_label,
        now=now,
        absolute_ttl=absolute,
        idle_ttl=idle,
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="session.created",
        target_type="session",
        target_id=model.id,
        detail={"audience": audience, "device": device_label},
    )
    return token, model


def rotate_session_token(session_row: Session, now: datetime) -> str | None:
    absolute, idle = _session_ttls()
    settings = get_settings()
    last = _aware(session_row.last_used_at) or now
    if now - last < timedelta(seconds=settings.session_rotate_after_seconds):
        session_row.last_used_at = now
        session_row.idle_expires_at = now + timedelta(seconds=idle)
        return None
    token = new_session_token()
    old_id = session_row.id
    session_row.token_hash = hash_token(token)
    session_row.rotated_from_id = old_id
    session_row.last_used_at = now
    session_row.idle_expires_at = now + timedelta(seconds=idle)
    return token


async def session_user(
    session: AsyncSession,
    token: str,
    *,
    rotate: bool = True,
) -> tuple[User, str | None]:
    """Resolve an opaque session token to its user, rotating the credential.

    Returns ``(user, new_token)`` where ``new_token`` is set exactly when the
    session was rotated and the caller must issue the replacement credential
    (replacing the cookie or vault value) atomically with this request. Pass
    ``rotate=False`` for bearer-style credentials that cannot receive a
    rotated value in-response (the CLI vault credential); those still enforce
    idle/absolute expiry and server-side revocation.
    """
    row = await SessionRepository(session).by_token_hash(hash_token(token))
    if row is None or row.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not valid")
    now = datetime.now(timezone.utc)
    if _aware(row.expires_at) is not None and now > _aware(row.expires_at):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session expired")
    if _aware(row.idle_expires_at) is not None and now > _aware(row.idle_expires_at):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session idle expired")
    user = await UserRepository(session).by_id(row.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not available")
    new_token = rotate_session_token(row, now) if rotate else None
    row.last_used_at = now
    return user, new_token


async def revoke_by_id(session: AsyncSession, session_id: int, user: User) -> bool:
    repo = SessionRepository(session)
    row = await repo.by_id(session_id)
    if row is None:
        raise SessionError("session not found", status.HTTP_404_NOT_FOUND)
    if row.user_id != user.id:
        raise SessionError("you do not own this session", status.HTTP_403_FORBIDDEN)
    if row.revoked_at is None:
        repo.revoke(row)
        await AuditRepository(session).record(
            actor_id=user.id,
            action="session.revoked",
            target_type="session",
            target_id=row.id,
        )
    return True


async def list_for_user(session: AsyncSession, user: User) -> list[Session]:
    return await SessionRepository(session).for_user(user.id)


def agreements_status(user: User) -> dict:
    settings = get_settings()
    return {
        "tos": "accepted" if user.tos_version >= settings.current_tos_version else "pending",
        "privacy": "accepted" if user.privacy_version >= settings.current_privacy_version else "pending",
        "publisher": "accepted" if user.publisher_agreement_version >= settings.current_publisher_agreement_version else "pending",
    }


async def accept_agreements(session: AsyncSession, user: User, tos: bool, privacy: bool, publisher: bool) -> dict:
    settings = get_settings()
    repo = UserAgreementRepository(session)
    mapping = [
        (tos, "tos", settings.current_tos_version),
        (privacy, "privacy", settings.current_privacy_version),
        (publisher, "publisher", settings.current_publisher_agreement_version),
    ]
    fields = {"tos": "tos_version", "privacy": "privacy_version", "publisher": "publisher_agreement_version"}
    for accepted, term, version in mapping:
        if not accepted:
            continue
        await repo.accept(user.id, term, version)
        setattr(user, fields[term], version)
        await AuditRepository(session).record(
            actor_id=user.id,
            action="agreement.accepted",
            target_type="user",
            target_id=user.id,
            detail={"term": term, "version": version},
        )
    return agreements_status(user)


async def publisher_ready(session: AsyncSession, user: User) -> bool:
    statuses = agreements_status(user)
    return statuses["tos"] == "accepted" and statuses["publisher"] == "accepted"


async def create_device_login(
    session: AsyncSession,
    *,
    client_name: str,
    requested_scopes: str,
    registry_origin: str | None,
    mode: str = "poll",
) -> dict:
    settings = get_settings()
    device_code = secrets.token_urlsafe(32)
    user_code = secrets.token_hex(3).upper()[:6]
    nonce = secrets.token_urlsafe(16)
    row = await LoginTransactionRepository(session).create(
        device_code_hash=hash_token(device_code),
        user_code=user_code,
        nonce=nonce,
        client_name=client_name,
        redirect_mode=mode,
        requested_scopes=requested_scopes,
        registry_origin=registry_origin,
        now=datetime.now(timezone.utc),
        ttl_seconds=settings.session_absolute_ttl_seconds,
    )
    host = settings.public_base_url.rstrip("/")
    return {
        "deviceCode": device_code,
        "userCode": user_code,
        "verificationUri": f"{host}/device?user_code={user_code}",
        "expiresIn": settings.session_absolute_ttl_seconds,
        "interval": 5,
        "_transactionId": row.id,
    }


async def approve_device_login(session: AsyncSession, user: User, user_code: str) -> None:
    repo = LoginTransactionRepository(session)
    row = await repo.by_user_code(user_code)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device code not found")
    if row.user_id is not None or row.completed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already approved")
    row.user_id = user.id
    row.completed_at = datetime.now(timezone.utc)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="login_transaction.approved",
        target_type="login_transaction",
        target_id=row.id,
        detail={"client": row.client_name},
    )


async def poll_device_login(session: AsyncSession, device_code: str) -> dict:
    repo = LoginTransactionRepository(session)
    row = await repo.by_device_code_hash(hash_token(device_code))
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid device code")
    now = datetime.now(timezone.utc)
    if now > _aware(row.expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expired_token")
    if row.user_id is None or row.completed_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="authorization_pending")
    user = await UserRepository(session).by_id(row.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not available")
    token, _ = await create_session(session, user, audience="cli", device_label=row.client_name)
    await repo.mark_completed(row)
    await session.commit()
    return {
        "accessToken": token,
        "username": user.username,
        "tokenType": "bearer",
    }