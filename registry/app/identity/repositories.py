from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.identity.models import (
    ApiToken,
    LoginTransaction,
    Session,
    SigningKey,
    User,
    UserAgreement,
)


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_github_id(self, github_id: str) -> User | None:
        return (
            await self.session.execute(select(User).where(User.github_id == github_id))
        ).scalar_one_or_none()

    async def by_id(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def by_username(self, username: str) -> User | None:
        return (
            await self.session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()

    async def by_ids(self, user_ids: list[int]) -> list[User]:
        if not user_ids:
            return []
        return (
            (await self.session.execute(select(User).where(User.id.in_(user_ids))))
            .scalars()
            .all()
        )

    async def create(
        self, *, username: str, github_id: str, avatar_url: str | None
    ) -> User:
        user = User(username=username, github_id=github_id, avatar_url=avatar_url)
        self.session.add(user)
        return user

    def update_status(self, user: User, status: str) -> None:
        user.status = status


class SigningKeyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_fingerprint(self, fingerprint: str) -> SigningKey | None:
        return (
            await self.session.execute(
                select(SigningKey).where(SigningKey.fingerprint == fingerprint)
            )
        ).scalar_one_or_none()

    async def by_id(self, key_id: int) -> SigningKey | None:
        return await self.session.get(SigningKey, key_id)

    async def for_user(self, user_id: int) -> list[SigningKey]:
        return (
            (
                await self.session.execute(
                    select(SigningKey).where(SigningKey.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )

    async def add(
        self,
        *,
        user_id: int,
        public_key_pem: str,
        fingerprint: str,
        label: str | None,
        expires_at=None,
    ) -> SigningKey:
        key = SigningKey(
            user_id=user_id,
            public_key_pem=public_key_pem,
            fingerprint=fingerprint,
            label=label,
            expires_at=expires_at,
        )
        self.session.add(key)
        return key

    def revoke(self, key: SigningKey) -> None:
        key.revoked_at = utcnow()

    async def revoke_all_for_user(self, user_id: int) -> int:
        """Bulk-revoke every signing key for a user; returns rows touched."""
        result = await self.session.execute(
            update(SigningKey)
            .where(SigningKey.user_id == user_id, SigningKey.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        return result.rowcount or 0


class SessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: int,
        token_hash: str,
        audience: str,
        device_label: str | None,
        now: datetime,
        absolute_ttl: int,
        idle_ttl: int,
    ) -> Session:
        row = Session(
            user_id=user_id,
            token_hash=token_hash,
            audience=audience,
            device_label=device_label,
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(seconds=absolute_ttl),
            idle_expires_at=now + timedelta(seconds=idle_ttl),
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def by_token_hash(self, token_hash: str) -> Session | None:
        return (
            await self.session.execute(
                select(Session).where(Session.token_hash == token_hash)
            )
        ).scalar_one_or_none()

    async def by_id(self, session_id: int) -> Session | None:
        return await self.session.get(Session, session_id)

    async def for_user(self, user_id: int) -> list[Session]:
        return (
            (
                await self.session.execute(
                    select(Session)
                    .where(Session.user_id == user_id)
                    .order_by(Session.created_at.desc())
                )
            )
            .scalars()
            .all()
        )

    async def revoke_all_for_user(self, user_id: int) -> int:
        """Bulk-revoke every active session for a user; returns rows touched."""
        result = await self.session.execute(
            update(Session)
            .where(Session.user_id == user_id, Session.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        return result.rowcount or 0

    def revoke(self, row: Session) -> None:
        row.revoked_at = utcnow()


class UserAgreementRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def accept(self, user_id: int, term_name: str, version: int) -> None:
        existing = (
            await self.session.execute(
                select(UserAgreement).where(
                    UserAgreement.user_id == user_id,
                    UserAgreement.term_name == term_name,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            self.session.add(
                UserAgreement(user_id=user_id, term_name=term_name, version=version)
            )
        else:
            existing.version = max(existing.version, version)
            existing.accepted_at = utcnow()


class LoginTransactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        device_code_hash: str,
        user_code: str,
        nonce: str,
        client_name: str,
        redirect_mode: str,
        requested_scopes: str,
        registry_origin: str | None,
        now: datetime,
        ttl_seconds: int,
    ) -> LoginTransaction:
        row = LoginTransaction(
            device_code_hash=device_code_hash,
            user_code=user_code,
            nonce=nonce,
            client_name=client_name,
            redirect_mode=redirect_mode,
            requested_scopes=requested_scopes,
            registry_origin=registry_origin,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def by_device_code_hash(
        self, device_code_hash: str
    ) -> LoginTransaction | None:
        return (
            await self.session.execute(
                select(LoginTransaction).where(
                    LoginTransaction.device_code_hash == device_code_hash
                )
            )
        ).scalar_one_or_none()

    async def by_user_code(self, user_code: str) -> LoginTransaction | None:
        return (
            await self.session.execute(
                select(LoginTransaction).where(LoginTransaction.user_code == user_code)
            )
        ).scalar_one_or_none()

    async def mark_completed(self, row: LoginTransaction) -> None:
        row.completed_at = utcnow()

    async def mark_issued(self, row: LoginTransaction) -> None:
        row.issued_at = utcnow()


class ApiTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: int,
        token_hash: str,
        prefix: str,
        label: str,
        scopes: str,
        organization_id: int | None,
        is_service_account: bool,
        expires_at: datetime | None,
    ) -> ApiToken:
        row = ApiToken(
            user_id=user_id,
            token_hash=token_hash,
            prefix=prefix,
            label=label,
            scopes=scopes,
            organization_id=organization_id,
            is_service_account=is_service_account,
            expires_at=expires_at,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def by_token_hash(self, token_hash: str) -> ApiToken | None:
        return (
            await self.session.execute(
                select(ApiToken).where(ApiToken.token_hash == token_hash)
            )
        ).scalar_one_or_none()

    async def by_id(self, token_id: int) -> ApiToken | None:
        return await self.session.get(ApiToken, token_id)

    async def for_user(self, user_id: int) -> list[ApiToken]:
        return (
            (
                await self.session.execute(
                    select(ApiToken)
                    .where(ApiToken.user_id == user_id)
                    .order_by(ApiToken.created_at.desc())
                )
            )
            .scalars()
            .all()
        )

    def touch(self, row: ApiToken, now: datetime) -> None:
        row.last_used_at = now

    async def revoke_all_for_user(self, user_id: int) -> int:
        """Bulk-revoke every active token for a user; returns rows touched."""
        result = await self.session.execute(
            update(ApiToken)
            .where(ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        return result.rowcount or 0

    def revoke(self, row: ApiToken) -> None:
        row.revoked_at = utcnow()

    def rotate(self, row: ApiToken, token_hash: str, prefix: str, expires_at: datetime | None) -> ApiToken:
        fresh = ApiToken(
            user_id=row.user_id,
            token_hash=token_hash,
            prefix=prefix,
            label=row.label,
            scopes=row.scopes,
            organization_id=row.organization_id,
            is_service_account=row.is_service_account,
            expires_at=expires_at,
            rotated_from_id=row.id,
        )
        self.session.add(fresh)
        row.revoked_at = utcnow()
        return fresh
