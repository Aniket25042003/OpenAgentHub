from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.identity.application import (
    IdentityError,
    KeyNotFound,
    KeyNotOwned,
    UserNotFound,
    get_current_user,
    issue_token,
    list_signing_keys,
    login_with_github,
    register_signing_key,
    require_active_user,
    require_admin,
    revoke_signing_key,
    suspend_user,
)
from app.identity.models import User
from app.schemas import (
    GithubExchangeRequest,
    GithubExchangeResponse,
    MeResponse,
    SignerKeyInfo,
    SuspendRequest,
    UploadKeyRequest,
)

router = APIRouter(prefix="/api/v1")


@router.post("/auth/github", response_model=GithubExchangeResponse)
async def github_login(req: GithubExchangeRequest, session: AsyncSession = Depends(get_session)):
    user = await login_with_github(session, req.code)
    await session.commit()
    await session.refresh(user)
    return GithubExchangeResponse(token=issue_token(user.id, user.username), username=user.username)


@router.post("/keys")
async def upload_key(
    req: UploadKeyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_active_user),
):
    try:
        fingerprint, key_id = await register_signing_key(session, user, req.publicKey, label=req.label, expires_at=req.expiresAt)
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "fingerprint": fingerprint, "id": key_id}


@router.delete("/keys/{key_id}")
async def revoke_key(
    key_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_active_user),
):
    try:
        key = await revoke_signing_key(session, user, key_id)
    except (KeyNotFound, KeyNotOwned) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "fingerprint": key.fingerprint, "revoked": True}


@router.post("/admin/users/{user_id}/suspend")
async def admin_suspend_user(
    user_id: int,
    req: SuspendRequest,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_admin),
):
    try:
        user = await suspend_user(session, actor, user_id, req.suspended)
    except (UserNotFound, IdentityError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "username": user.username, "status": user.status}


@router.get("/me", response_model=MeResponse)
async def me(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    keys = await list_signing_keys(session, user)
    return MeResponse(
        username=user.username,
        role=user.role,
        status=user.status,
        publicKeys=[SignerKeyInfo.from_key(k) for k in keys],
    )
