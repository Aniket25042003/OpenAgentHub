from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.outbox.models import OutboxEvent


class OutboxRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add_event(self, event_type: str, payload: dict, schema_version: int = 1) -> OutboxEvent:
        event = OutboxEvent(event_type=event_type, payload=payload, schema_version=schema_version)
        self.session.add(event)
        await self.session.flush()
        return event

    async def unpublished(self, limit: int = 50) -> list[OutboxEvent]:
        return (
            await self.session.execute(
                select(OutboxEvent).where(OutboxEvent.published_at.is_(None)).order_by(OutboxEvent.id).limit(limit)
            )
        ).scalars().all()

    async def mark_published(self, event: OutboxEvent) -> None:
        from app.db import utcnow

        event.published_at = utcnow()
