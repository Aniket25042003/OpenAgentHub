from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import SigningKey, User
from app.schemas import MeResponse

router = APIRouter(prefix="/api/v1")


@router.get("/me", response_model=MeResponse)
async def me(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    keys = (await session.execute(select(SigningKey).where(SigningKey.user_id == user.id))).scalars().all()
    return MeResponse(username=user.username, publicKeys=[{"id": str(k.id)} for k in keys])
