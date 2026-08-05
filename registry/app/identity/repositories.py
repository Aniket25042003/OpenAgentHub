from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.identity.models import SigningKey, User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_github_id(self, github_id: str) -> User | None:
        return (
            await self.session.execute(select(User).where(User.github_id == github_id))
        ).scalar_one_or_none()

    async def by_id(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def create(self, *, username: str, github_id: str, avatar_url: str | None) -> User:
        user = User(username=username, github_id=github_id, avatar_url=avatar_url)
        self.session.add(user)
        return user


class SigningKeyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_fingerprint(self, fingerprint: str) -> SigningKey | None:
        return (
            await self.session.execute(select(SigningKey).where(SigningKey.fingerprint == fingerprint))
        ).scalar_one_or_none()

    async def for_user(self, user_id: int) -> list[SigningKey]:
        return (
            await self.session.execute(select(SigningKey).where(SigningKey.user_id == user_id))
        ).scalars().all()

    async def add(self, *, user_id: int, public_key_pem: str, fingerprint: str) -> SigningKey:
        key = SigningKey(user_id=user_id, public_key_pem=public_key_pem, fingerprint=fingerprint)
        self.session.add(key)
        return key
