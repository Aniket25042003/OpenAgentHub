"""Buffered archive download counting.

Archive downloads must not cause a synchronous database write per request
(verification gate). Counts accumulate in an in-process buffer and are applied
to ``agent_versions.download_count`` in a single batched pass by a periodic
background task; a final flush runs at shutdown.
"""

import asyncio
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db import get_session_factory
from app.quotas.application import current_period


class DownloadCountBuffer:
    def __init__(self) -> None:
        self._counts: dict[int, int] = {}
        self._usage: dict[tuple[int, str], list[int]] = {}
        self._drained_at = time.monotonic()
        self._task: asyncio.Task | None = None
        self._interval: float = 30.0

    def configure(self, interval_seconds: float) -> None:
        self._interval = interval_seconds

    def record(self, version_id: int, *, organization_id: int | None = None, bytes: int = 0) -> None:
        self._counts[version_id] = self._counts.get(version_id, 0) + 1
        if organization_id is not None:
            key = (organization_id, current_period())
            entry = self._usage.setdefault(key, [0, 0])
            entry[0] += bytes
            entry[1] += 1

    def drain(self) -> tuple[dict[int, int], dict[tuple[int, str], list[int]]]:
        counts = self._counts
        usage = self._usage
        self._counts = {}
        self._usage = {}
        self._drained_at = time.monotonic()
        return counts, usage

    @property
    def pending(self) -> int:
        return len(self._counts)

    def pending_org_bytes(self, organization_id: int, period: str) -> int:
        return self._usage.get((organization_id, period), [0, 0])[0]

    async def flush(self, session_factory: async_sessionmaker[Any] | None = None) -> int:
        counts, usage = self.drain()
        total = 0
        if not counts and not usage:
            return 0
        factory = session_factory or get_session_factory()
        async with factory() as session:
            for version_id, amount in counts.items():
                await session.execute(
                    text("UPDATE agent_versions SET download_count = download_count + :amount WHERE id = :id"),
                    {"amount": amount, "id": version_id},
                )
                total += amount
            for (organization_id, period), (bytes_, count) in usage.items():
                await _upsert_org_usage(session, organization_id, period, bytes_, count)
            await session.commit()
        return total

    async def _run(self) -> None:
        while True:
            try:
                await self.flush()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - counter must never die
                pass
            await asyncio.sleep(self._interval)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self, flush: bool = True) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if flush:
            try:
                await self.flush()
            except Exception:  # noqa: BLE001
                pass


async def _upsert_org_usage(session, organization_id: int, period: str, bytes_: int, count: int) -> None:
    from sqlalchemy import text as sqltext

    now = time.strftime("%Y-%m-%d %H:%M:%S")
    row = (
        await session.execute(
            sqltext("SELECT id FROM org_monthly_usage WHERE organization_id = :org AND period = :p"),
            {"org": organization_id, "p": period},
        )
    ).first()
    if row is None:
        await session.execute(
            sqltext(
                "INSERT INTO org_monthly_usage (organization_id, period, download_bytes, download_count, updated_at) "
                "VALUES (:org, :p, :b, :c, :now)"
            ),
            {"org": organization_id, "p": period, "b": bytes_, "c": count, "now": now},
        )
    else:
        await session.execute(
            sqltext(
                "UPDATE org_monthly_usage SET download_bytes = download_bytes + :bytes, "
                "download_count = download_count + :count, updated_at = :now WHERE id = :id"
            ),
            {"bytes": bytes_, "count": count, "id": row[0], "now": now},
        )


_buffer: DownloadCountBuffer | None = None


def get_download_buffer(interval_seconds: float = 30.0) -> DownloadCountBuffer:
    global _buffer
    if _buffer is None:
        _buffer = DownloadCountBuffer()
    _buffer.configure(interval_seconds)
    return _buffer
