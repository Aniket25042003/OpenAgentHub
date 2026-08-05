import asyncio
import logging

from app.db import get_session_factory, utcnow
from app.outbox.queue import DurableQueue
from app.outbox.worker import JobWorker
from app.telemetry import get_logger, metrics

log: logging.Logger = get_logger("workers.maintenance")


class MaintenanceWorker(JobWorker):
    """Recovers stale leases (crashed workers) and prunes old queue history."""

    job_type = "maintenance.sweep"
    retention_days: int = 14

    async def handle(self, session, payload: dict) -> None:  # noqa: ARG002
        queue = DurableQueue()
        now = utcnow()
        requeued = await queue.reap_stale_leases(session, now)
        pruned = await queue.reap_old_jobs(session, self.retention_days, now)
        metrics.add("maintenance_requeued_total", requeued)
        metrics.add("maintenance_pruned_total", pruned)
        log.info("maintenance sweep: requeued %d stale leases, pruned %d old jobs", requeued, pruned)

    async def run_once(self) -> int:
        # Sweeps run on every iteration regardless of job availability.
        async with get_session_factory()() as session:
            await DurableQueue().reap_stale_leases(session)
            await session.commit()
        return await super().run_once()


async def main() -> None:
    worker = MaintenanceWorker()
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
