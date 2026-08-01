from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import exchange_github_code, issue_token, upsert_github_user
from app.db import get_session
from app.schemas import GithubExchangeRequest, GithubExchangeResponse

router = APIRouter(prefix="/api/v1/auth")


@router.post("/github", response_model=GithubExchangeResponse)
async def github_login(req: GithubExchangeRequest, session: AsyncSession = Depends(get_session)):
    username, github_id, avatar_url = await exchange_github_code(req.code)
    user = await upsert_github_user(session, username, github_id, avatar_url)
    return GithubExchangeResponse(token=issue_token(user.id, user.username), username=user.username)
