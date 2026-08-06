import time
from datetime import datetime

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.db import get_session
from app.identity.models import SigningKey, User
from app.identity.repositories import ApiTokenRepository, SessionRepository, SigningKeyRepository, UserRepository

_bearer = HTTPBearer(auto_error=False)


class IdentityError(ValueError):
    status_code = status.HTTP_400_BAD_REQUEST


class KeyAlreadyRegistered(IdentityError):
    status_code = status.HTTP_409_CONFLICT


class KeyNotFound(IdentityError):
    status_code = status.HTTP_404_NOT_FOUND


class KeyNotOwned(IdentityError):
    status_code = status.HTTP_403_FORBIDDEN


class UserNotFound(IdentityError):
    status_code = status.HTTP_404_NOT_FOUND


def issue_token(user_id: int, username: str) -> str:
    settings = get_settings()
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + settings.token_ttl_seconds,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token") from exc


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    token = credentials.credentials
    user = await _user_from_bearer(token, session)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user no longer exists")
    return user


async def _user_from_session(session: AsyncSession, token: str) -> User | None:
    from app.identity.sessions import session_user

    try:
        user, _ = await session_user(session, token, rotate=False)
        return user
    except HTTPException:
        return None


async def _user_from_api_token(session: AsyncSession, token: str) -> User | None:
    from datetime import datetime, timezone

    row = await ApiTokenRepository(session).by_token_hash(_hash_token(token))
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at is not None:
        expires = row.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            return None
    user = await session.get(User, row.user_id)
    if user is None or user.status != "active":
        return None
    ApiTokenRepository(session).touch(row, datetime.now(timezone.utc))
    return user


def _hash_token(token: str) -> str:
    from app.identity.sessions import hash_token

    return hash_token(token)


async def require_active_user(user: User = Depends(get_current_user)) -> User:
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account is suspended")
    return user


async def api_token_scopes(request: Request, session: AsyncSession) -> frozenset[str] | None:
    """Return the scope set of the bearer credential, or None for session/JWT auth.

    API tokens carry explicit scopes; interactive sessions and CLI JWTs are
    full-access credentials and return None. Routes that need scoping check
    ``require_scope`` which consults this.
    """
    bearer = request.headers.get("authorization", "")
    if not bearer.startswith("Bearer "):
        return None
    token = bearer.removeprefix("Bearer ").strip()
    if not token:
        return None
    try:
        decode_token(token)
        return None
    except HTTPException:
        pass
    from app.identity.api_tokens import scope_set
    from app.identity.sessions import hash_token

    row = await ApiTokenRepository(session).by_token_hash(hash_token(token))
    if row is None or row.revoked_at is not None:
        return None
    return scope_set(row.scopes)


def require_scope(*scopes: str):
    """Dependency: deny API-token-authenticated requests lacking any required scope.

    Interactive session/JWT credentials are full-access and always pass.
    """

    async def _check(
        request: Request,
        session: AsyncSession = Depends(get_session),
        user: User = Depends(require_active_user),
    ) -> User:
        granted = await api_token_scopes(request, session)
        if granted is not None and not (set(scopes) & granted):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"token lacks required scope (need one of: {', '.join(scopes)})",
            )
        return user

    return _check


def require_roles(*roles: str):
    async def _check(user: User = Depends(require_active_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return user

    return _check


require_admin = require_roles("admin")
require_reviewer_or_admin = require_roles("reviewer", "admin")


async def resolve_cookie_user(request: Request, session: AsyncSession) -> User:
    from app.identity.sessions import session_user

    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        bearer = request.headers.get("authorization", "")
        if bearer.startswith("Bearer "):
            user = await _user_from_bearer(bearer.removeprefix("Bearer ").strip(), session)
            if user is not None:
                return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not signed in")
    user, _ = await session_user(session, token)
    return user


async def resolve_cookie_active_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    user = await resolve_cookie_user(request, session)
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account is suspended")
    return user


async def resolve_optional_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User | None:
    """Resolve the logged-in user (cookie or bearer) without requiring one."""
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        from app.identity.sessions import session_user

        try:
            user, _ = await session_user(session, token, rotate=False)
            return user
        except HTTPException:
            return None
    bearer = request.headers.get("authorization", "")
    if bearer.startswith("Bearer "):
        return await _user_from_bearer(bearer.removeprefix("Bearer ").strip(), session)
    return None


def resolve_cookie_role(*roles: str):
    async def _check(
        request: Request, session: AsyncSession = Depends(get_session)
    ) -> User:
        user = await resolve_cookie_user(request, session)
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
        if user.status != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account is suspended")
        return user

    return _check


resolve_cookie_reviewer_or_admin = resolve_cookie_role("reviewer", "admin")


async def _user_from_bearer(token: str, session: AsyncSession) -> User | None:
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
        user = await session.get(User, user_id)
        if user is not None:
            return user
    except (HTTPException, KeyError, ValueError):
        pass
    user = await _user_from_session(session, token)
    if user is not None:
        return user
    return await _user_from_api_token(session, token)


async def exchange_github_code(code: str) -> tuple[str, str, str | None]:
    """Exchange an OAuth code for a GitHub identity. Returns (username, github_id, avatar_url)."""
    settings = get_settings()
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GitHub OAuth is not configured")
    async with httpx.AsyncClient(timeout=20) as client:
        tok_res = await client.post(
            settings.github_token_url,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
        )
        tok_data = tok_res.json()
        access_token = tok_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="GitHub code exchange failed")
        user_res = await client.get(
            settings.github_user_url, headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
        )
        if user_res.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="GitHub identity fetch failed")
        profile = user_res.json()
    username = profile.get("login")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="GitHub profile missing login")
    return username, str(profile.get("id", "")), profile.get("avatar_url")


async def login_with_github(session: AsyncSession, code: str) -> User:
    username, github_id, avatar_url = await exchange_github_code(code)
    repo = UserRepository(session)
    user = await repo.by_github_id(github_id)
    if user is None:
        user = await repo.create(username=username, github_id=github_id, avatar_url=avatar_url)
    else:
        user.username = username
        user.avatar_url = avatar_url or user.avatar_url
    return user


async def register_signing_key(
    session: AsyncSession,
    user: User,
    public_key_pem: str,
    *,
    label: str | None = None,
    expires_at: datetime | None = None,
) -> tuple[str, int]:
    from app.crypto import SignatureError, load_ed25519_public_key, public_key_fingerprint

    try:
        load_ed25519_public_key(public_key_pem)
    except SignatureError as exc:
        raise IdentityError(str(exc)) from exc

    fingerprint = public_key_fingerprint(public_key_pem)
    repo = SigningKeyRepository(session)
    existing = await repo.by_fingerprint(fingerprint)
    if existing is not None:
        if existing.user_id != user.id:
            raise KeyAlreadyRegistered("public key is already registered to another account")
        return existing.fingerprint, existing.id
    key = await repo.add(
        user_id=user.id, public_key_pem=public_key_pem, fingerprint=fingerprint, label=label, expires_at=expires_at
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="key.uploaded",
        target_type="signing_key",
        target_id=key.id,
        detail={"fingerprint": fingerprint, "label": label},
    )
    return key.fingerprint, key.id


async def revoke_signing_key(session: AsyncSession, user: User, key_id: int) -> SigningKey:
    repo = SigningKeyRepository(session)
    key = await repo.by_id(key_id)
    if key is None:
        raise KeyNotFound("signing key not found")
    if key.user_id != user.id:
        raise KeyNotOwned("you do not own this signing key")
    if key.revoked_at is None:
        repo.revoke(key)
        await AuditRepository(session).record(
            actor_id=user.id,
            action="key.revoked",
            target_type="signing_key",
            target_id=key.id,
            detail={"fingerprint": key.fingerprint},
        )
    return key


async def list_signing_keys(session: AsyncSession, user: User) -> list[SigningKey]:
    return await SigningKeyRepository(session).for_user(user.id)


async def suspend_user(session: AsyncSession, actor: User, user_id: int, suspended: bool) -> User:
    user = await UserRepository(session).by_id(user_id)
    if user is None:
        raise UserNotFound("user not found")
    if user.id == actor.id:
        raise IdentityError("cannot suspend yourself")
    new_status = "suspended" if suspended else "active"
    if user.status != new_status:
        UserRepository(session).update_status(user, new_status)
        await SessionRepository(session).revoke_all_for_user(user.id)
        await AuditRepository(session).record(
            actor_id=actor.id,
            action="user.suspended" if suspended else "user.unsuspended",
            target_type="user",
            target_id=user.id,
            detail={"username": user.username},
        )
    return user

