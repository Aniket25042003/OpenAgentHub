from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import SigningKey, User
from app.schemas import UploadKeyRequest
from app.security import SignatureError, load_ed25519_public_key, public_key_fingerprint

router = APIRouter(prefix="/api/v1")


@router.post("/keys")
async def upload_key(
    req: UploadKeyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        load_ed25519_public_key(req.publicKey)
    except SignatureError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    fingerprint = public_key_fingerprint(req.publicKey)
    existing = (
        await session.execute(select(SigningKey).where(SigningKey.fingerprint == fingerprint))
    ).scalar_one_or_none()
    if existing is not None:
        return {"ok": True, "fingerprint": existing.fingerprint, "id": existing.id}

    key = SigningKey(user_id=user.id, public_key_pem=req.publicKey, fingerprint=fingerprint)
    session.add(key)
    await session.commit()
    return {"ok": True, "fingerprint": key.fingerprint, "id": key.id}
