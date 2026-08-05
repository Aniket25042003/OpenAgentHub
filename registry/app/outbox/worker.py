import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session_factory
from app.outbox.queue import DurableQueue
from app.telemetry import get_logger, metrics

log: logging.Logger = get_logger("outbox.worker")


class JobWorker:
    """Idempotent, retryable worker base.

    Subclasses implement `handle` (module-owned application calls). The base
    claims one job per iteration, acks on success, and applies retry/backoff or
    dead-lettering on failure. Workers are safe against duplicate delivery.
    """

    job_type: str = ""
    poll_interval: float = 1.0

    def __init__(self, queue: DurableQueue | None = None, worker_id: str | None = None) -> None:
        self.queue = queue or DurableQueue()
        self.worker_id = worker_id or f"{self.job_type}-{__import__('socket').gethostname()[:16]}"

    async def handle(self, session: AsyncSession, payload: dict) -> None:  # pragma: no cover - abstract
        raise NotImplementedError

    async def run_once(self) -> int:
        async with get_session_factory()() as session:
            job = await self.queue.claim(session, self.job_type, self.worker_id)
            if job is None:
                return 0
            try:
                await self.handle(session, job.payload)
                await self.queue.complete(session, job.id)
                await session.commit()
                metrics.incr("queue_jobs_processed_total", job_type=self.job_type, status="succeeded")
                return 1
            except asyncio.CancelledError:
                await session.rollback()
                raise
            except Exception as exc:  # noqa: BLE001 - worker must not crash
                log.exception("job %s (%s) failed", job.id, self.job_type)
                await self.queue.fail(session, job.id, str(exc)[:1000])
                await session.commit()
                metrics.incr("queue_jobs_processed_total", job_type=self.job_type, status="failed")
                return 1

    async def run_forever(self) -> None:
        log.info("worker %s starting (job_type=%s)", self.worker_id, self.job_type)
        while True:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("worker %s iteration failed", self.worker_id)
            await asyncio.sleep(self.poll_interval)
