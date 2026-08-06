from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditEvent


class AuditRepository:
    """Append-only audit trail. Never store secrets, prompts, or tokens in detail."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(
        self,
        *,
        actor_id: int | None,
        action: str,
        target_type: str | None = None,
        target_id: int | None = None,
        detail: dict | None = None,
        organization_id: int | None = None,
        namespace: str | None = None,
        name: str | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            actor_id=actor_id,
            organization_id=organization_id,
            namespace=namespace,
            name=name,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=detail or {},
        )
        self.session.add(event)
        await self.session.flush()
        return event

    async def count_by_action(self, *, actor_id: int, action: str, since: datetime) -> int:
        stmt = select(func.count(AuditEvent.id)).where(
            AuditEvent.actor_id == actor_id, AuditEvent.action == action, AuditEvent.created_at >= since
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def recent_for_actor(self, *, actor_id: int, limit: int = 20) -> list[AuditEvent]:
        stmt = (
            select(AuditEvent)
            .where(AuditEvent.actor_id == actor_id)
            .order_by(AuditEvent.created_at.desc())
            .limit(limit)
        )
        return (await self.session.execute(stmt)).scalars().all()

    async def search(
        self,
        *,
        organization_id: int | None = None,
        namespace: str | None = None,
        name: str | None = None,
        actor_id: int | None = None,
        action: str | None = None,
        target_type: str | None = None,
        limit: int = 50,
        before_id: int | None = None,
    ) -> list[AuditEvent]:
        """Filtered, paginated audit events, newest first (keyset by id)."""
        stmt = select(AuditEvent)
        if organization_id is not None:
            stmt = stmt.where(AuditEvent.organization_id == organization_id)
        if namespace is not None:
            stmt = stmt.where(AuditEvent.namespace == namespace)
        if name is not None:
            stmt = stmt.where(AuditEvent.name == name)
        if actor_id is not None:
            stmt = stmt.where(AuditEvent.actor_id == actor_id)
        if action is not None:
            stmt = stmt.where(AuditEvent.action == action)
        if target_type is not None:
            stmt = stmt.where(AuditEvent.target_type == target_type)
        if before_id is not None:
            stmt = stmt.where(AuditEvent.id < before_id)
        stmt = stmt.order_by(AuditEvent.id.desc()).limit(limit)
        return (await self.session.execute(stmt)).scalars().all()

    async def retention_range(self, *, organization_id: int | None = None) -> tuple[datetime | None, int]:
        """Oldest event timestamp and total count (used to surface retention info)."""
        stmt = select(func.min(AuditEvent.created_at), func.count(AuditEvent.id))
        if organization_id is not None:
            stmt = stmt.where(AuditEvent.organization_id == organization_id)
        row = (await self.session.execute(stmt)).one()
        return row[0], row[1]