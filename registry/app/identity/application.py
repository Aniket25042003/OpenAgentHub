import time

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity.models import SigningKey, User
from app.identity.repositories import SigningKeyRepository, UserRepository

_bearer = HTTPBearer(auto_error=False)


class IdentityError(ValueError):
    pass


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
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    user = await UserRepository(session).by_id(int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user no longer exists")
    return user


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


async def register_signing_key(session: AsyncSession, user: User, public_key_pem: str) -> tuple[str, int]:
    from app.crypto import SignatureError, load_ed25519_public_key, public_key_fingerprint

    try:
        load_ed25519_public_key(public_key_pem)
    except SignatureError as exc:
        raise IdentityError(str(exc)) from exc

    fingerprint = public_key_fingerprint(public_key_pem)
    repo = SigningKeyRepository(session)
    existing = await repo.by_fingerprint(fingerprint)
    if existing is not None:
        return existing.fingerprint, existing.id
    key = await repo.add(user_id=user.id, public_key_pem=public_key_pem, fingerprint=fingerprint)
    return key.fingerprint, key.id


async def list_signing_keys(session: AsyncSession, user: User) -> list[SigningKey]:
    return await SigningKeyRepository(session).for_user(user.id)
