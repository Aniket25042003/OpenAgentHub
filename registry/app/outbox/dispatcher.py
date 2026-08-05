import asyncio
import logging

from app.db import get_session_factory, utcnow
from app.outbox.queue import DurableQueue
from app.outbox.repositories import OutboxRepository
from app.telemetry import get_logger, metrics

log: logging.Logger = get_logger("outbox.dispatcher")

EVENT_TO_JOB: dict[str, tuple[str, str]] = {
    "scan.requested": ("scan.run", "scan"),
}


class OutboxDispatcher:
    """Polls the transactional outbox and publishes committed events to the durable queue."""

    def __init__(self, queue: DurableQueue | None = None, poll_interval: float = 1.0) -> None:
        self.queue = queue or DurableQueue()
        self.poll_interval = poll_interval
        self._task: asyncio.Task | None = None

    async def dispatch_once(self) -> int:
        async with get_session_factory()() as session:
            events = await OutboxRepository(session).unpublished()
            for event in events:
                mapping = EVENT_TO_JOB.get(event.event_type)
                if mapping is None:
                    log.warning("no job mapping for outbox event type %s (event %s)", event.event_type, event.id)
                    await OutboxRepository(session).mark_published(event)
                    continue
                job_type, prefix = mapping
                await self.queue.enqueue(
                    session,
                    job_type,
                    event.payload,
                    dedupe_key=f"{prefix}:{event.payload.get('version_id', event.id)}",
                    schema_version=event.schema_version,
                )
                await OutboxRepository(session).mark_published(event)
                metrics.incr("outbox_events_published_total", event_type=event.event_type)
            await session.commit()
            return len(events)

    async def run_forever(self) -> None:
        while True:
            try:
                await self.dispatch_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - dispatcher must never die
                log.exception("outbox dispatch iteration failed")
            await asyncio.sleep(self.poll_interval)

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self.run_forever())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
