import asyncio
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.outbox.models import QueueJob

JOB_QUEUED = "queued"
JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_DEAD = "dead"

ACTIVE_STATUSES = (JOB_QUEUED, JOB_RUNNING, JOB_SUCCEEDED)


class QueueError(ValueError):
    pass


class DurableQueue:
    """Lease-based durable queue backed by the shared database.

    A job is claimed atomically (status -> running), completed (succeeded), or
    failed with retry/backoff until max_attempts, then dead-lettered.
    """

    def __init__(self, lease_seconds: float = 60.0, max_attempts: int = 5, backoff_base_seconds: float = 1.0) -> None:
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        self.backoff_base_seconds = backoff_base_seconds

    async def enqueue(self, session: AsyncSession, job_type: str, payload: dict, *, dedupe_key: str, schema_version: int = 1) -> bool:
        existing = (
            await session.execute(
                select(QueueJob.id).where(
                    QueueJob.job_type == job_type,
                    QueueJob.dedupe_key == dedupe_key,
                    QueueJob.status.in_(ACTIVE_STATUSES),
                )
            )
        ).first()
        if existing is not None:
            return False
        job = QueueJob(
            job_type=job_type,
            payload=payload,
            schema_version=schema_version,
            dedupe_key=dedupe_key,
            max_attempts=self.max_attempts,
        )
        session.add(job)
        await session.flush()
        return True

    async def claim(self, session: AsyncSession, job_type: str, owner: str, now=None) -> QueueJob | None:
        now = now or utcnow()
        candidate = (
            await session.execute(
                select(QueueJob)
                .where(
                    QueueJob.job_type == job_type,
                    QueueJob.status == JOB_QUEUED,
                    QueueJob.next_attempt_at <= now,
                    (QueueJob.leased_until.is_(None)) | (QueueJob.leased_until < now),
                )
                .order_by(QueueJob.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if candidate is None:
            return None
        result = await session.execute(
            update(QueueJob)
            .where(QueueJob.id == candidate.id, QueueJob.status == JOB_QUEUED)
            .values(
                status=JOB_RUNNING,
                attempts=QueueJob.attempts + 1,
                leased_until=now + timedelta(seconds=self.lease_seconds),
                lease_owner=owner,
            )
        )
        if result.rowcount == 0:
            return None
        return candidate

    async def complete(self, session: AsyncSession, job_id: int) -> None:
        await session.execute(
            update(QueueJob)
            .where(QueueJob.id == job_id)
            .values(status=JOB_SUCCEEDED, leased_until=None, lease_owner=None, last_error=None)
        )

    async def fail(self, session: AsyncSession, job_id: int, error: str, now=None) -> None:
        now = now or utcnow()
        job = await session.get(QueueJob, job_id)
        if job is None:
            return
        if job.attempts >= job.max_attempts:
            await session.execute(
                update(QueueJob)
                .where(QueueJob.id == job_id)
                .values(status=JOB_DEAD, leased_until=None, lease_owner=None, last_error=error)
            )
            return
        backoff = min(self.backoff_base_seconds * (2 ** (job.attempts - 1)), 60.0)
        await session.execute(
            update(QueueJob)
            .where(QueueJob.id == job_id)
            .values(
                status=JOB_QUEUED,
                leased_until=None,
                lease_owner=None,
                next_attempt_at=now + timedelta(seconds=backoff),
                last_error=error,
            )
        )

    async def reap_stale_leases(self, session: AsyncSession, now=None) -> int:
        """Requeue jobs whose lease expired (worker crashed before completing)."""
        now = now or utcnow()
        result = await session.execute(
            update(QueueJob)
            .where(QueueJob.status == JOB_RUNNING, QueueJob.leased_until < now)
            .values(status=JOB_QUEUED, leased_until=None, lease_owner=None)
        )
        return result.rowcount or 0

    async def reap_old_jobs(self, session: AsyncSession, retention_days: int = 14, now=None) -> int:
        now = now or utcnow()
        cutoff = now - timedelta(days=retention_days)
        result = await session.execute(
            delete(QueueJob).where(QueueJob.status.in_((JOB_SUCCEEDED, JOB_DEAD)), QueueJob.updated_at < cutoff)
        )
        return result.rowcount or 0
