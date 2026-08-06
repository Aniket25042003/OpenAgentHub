"""Long-lived, scoped API tokens for programmatic access (M-8.7).

Tokens are bearer credentials separate from interactive sessions and signing
keys. Only a SHA-256 hash of a token is stored, plus an identifiable ``prefix``;
the raw token is shown exactly once at creation. Each token carries a
comma-separated scope list and may be narrowed to a single organization
(``organization_id``). Lifecycle controls cover expiration, rotation,
last-used tracking, and immediate revocation.
"""

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import ApiToken, User
from app.identity.repositories import ApiTokenRepository
from app.identity.sessions import hash_token

TOKEN_SCOPES = (
    "packages:read",
    "packages:publish",
    "packages:manage",
    "keys:manage",
    "members:manage",
    "audit:read",
    "billing:read",
    "billing:manage",
)
DEFAULT_TOKEN_SCOPES = ("packages:read", "packages:publish")
SCOPE_SET = frozenset(TOKEN_SCOPES)

_TOKEN_PREFIX_CHARS = 12


def scope_set(scopes: str) -> frozenset[str]:
    return frozenset(s for s in (p.strip() for p in scopes.split(",")) if s)


def validate_scopes(scopes: list[str]) -> list[str]:
    unknown = [s for s in scopes if s not in SCOPE_SET]
    if unknown:
        raise TokenError(f"invalid scopes: {', '.join(unknown)}")
    return sorted(set(scopes))


def issue_token() -> tuple[str, str, str]:
    raw = "oah_" + secrets.token_urlsafe(36)
    return raw, hash_token(raw), raw[: _TOKEN_PREFIX_CHARS]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TokenError(ValueError):
    status_code = 400


class TokenNotFound(TokenError):
    status_code = 404


class TokenNotOwned(TokenError):
    status_code = 403


async def create_api_token(
    session: AsyncSession,
    user: User,
    *,
    label: str,
    scopes: list[str],
    organization_id: int | None = None,
    is_service_account: bool = False,
    expires_in_days: int | None = None,
) -> tuple[str, ApiToken]:
    settings = get_settings()
    if not label.strip() or len(label.strip()) > 64:
        raise TokenError("label is required (max 64 chars)")
    granted = validate_scopes(scopes)
    if settings.token_allowed_scopes:
        allowed = frozenset(s.strip() for s in settings.token_allowed_scopes.split(","))
        denied = granted - allowed
        if denied:
            raise TokenError(f"scopes not allowed by policy: {', '.join(sorted(denied))}")

    lifetime = timedelta(days=expires_in_days or settings.token_default_ttl_days)
    if lifetime > timedelta(days=settings.token_max_lifetime_days):
        raise TokenError(f"lifetime exceeds the maximum of {settings.token_max_lifetime_days} days")
    requested = int(expires_in_days or settings.token_default_ttl_days)
    expires_at = None if requested <= 0 else _now() + lifetime

    raw, token_hash, prefix = issue_token()
    row = await ApiTokenRepository(session).create(
        user_id=user.id,
        token_hash=token_hash,
        prefix=prefix,
        label=label.strip(),
        scopes=",".join(sorted(granted)),
        organization_id=organization_id,
        is_service_account=is_service_account,
        expires_at=expires_at,
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="token.created",
        target_type="api_token",
        target_id=row.id,
        detail={
            "prefix": prefix,
            "scopes": ",".join(sorted(granted)),
            "organizationId": organization_id,
            "isServiceAccount": is_service_account,
        },
    )
    return raw, row


async def list_api_tokens(session: AsyncSession, user: User) -> list[ApiToken]:
    return await ApiTokenRepository(session).for_user(user.id)


async def revoke_api_token(session: AsyncSession, user: User, token_id: int) -> ApiToken:
    repo = ApiTokenRepository(session)
    row = await repo.by_id(token_id)
    if row is None:
        raise TokenNotFound("API token not found")
    if row.user_id != user.id:
        raise TokenNotOwned("you do not own this API token")
    if row.revoked_at is None:
        repo.revoke(row)
        await AuditRepository(session).record(
            actor_id=user.id,
            action="token.revoked",
            target_type="api_token",
            target_id=row.id,
            detail={"prefix": row.prefix},
        )
    return row


async def rotate_api_token(
    session: AsyncSession, user: User, token_id: int, *, expires_in_days: int | None = None
) -> tuple[str, ApiToken]:
    repo = ApiTokenRepository(session)
    existing = await repo.by_id(token_id)
    if existing is None:
        raise TokenNotFound("API token not found")
    if existing.user_id != user.id:
        raise TokenNotOwned("you do not own this API token")
    days = expires_in_days or get_settings().token_default_ttl_days
    if timedelta(days=days) > timedelta(days=get_settings().token_max_lifetime_days):
        raise TokenError(f"lifetime exceeds the maximum of {get_settings().token_max_lifetime_days} days")
    raw, hashed, prefix = issue_token()
    fresh = repo.rotate(existing, hashed, prefix, _now() + timedelta(days=days))
    await AuditRepository(session).record(
        actor_id=user.id,
        action="token.rotated",
        target_type="api_token",
        target_id=existing.id,
        detail={"prefix": existing.prefix, "newPrefix": prefix},
    )
    return raw, fresh


async def api_token_from_raw(session: AsyncSession, raw: str) -> ApiToken | None:
    return await ApiTokenRepository(session).by_token_hash(hash_token(raw))