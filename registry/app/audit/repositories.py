from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditEvent


class AuditRepository:
    """Append-only audit trail. Never store secrets, prompts, or tokens in detail."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(self, *, actor_id: int | None, action: str, target_type: str | None = None, target_id: int | None = None, detail: dict | None = None) -> AuditEvent:
        event = AuditEvent(
            actor_id=actor_id,
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
