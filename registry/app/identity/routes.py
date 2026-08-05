from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.identity.application import IdentityError, get_current_user, issue_token, list_signing_keys, login_with_github, register_signing_key
from app.identity.models import User
from app.schemas import GithubExchangeRequest, GithubExchangeResponse, MeResponse, UploadKeyRequest

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
    user: User = Depends(get_current_user),
):
    try:
        fingerprint, key_id = await register_signing_key(session, user, req.publicKey)
    except IdentityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "fingerprint": fingerprint, "id": key_id}


@router.get("/me", response_model=MeResponse)
async def me(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    keys = await list_signing_keys(session, user)
    return MeResponse(username=user.username, publicKeys=[{"id": str(k.id)} for k in keys])
