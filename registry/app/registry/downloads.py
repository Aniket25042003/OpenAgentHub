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


class DownloadCountBuffer:
    def __init__(self) -> None:
        self._counts: dict[int, int] = {}
        self._drained_at = time.monotonic()
        self._task: asyncio.Task | None = None
        self._interval: float = 30.0

    def configure(self, interval_seconds: float) -> None:
        self._interval = interval_seconds

    def record(self, version_id: int) -> None:
        self._counts[version_id] = self._counts.get(version_id, 0) + 1

    @property
    def pending(self) -> int:
        return len(self._counts)

    async def flush(self, session_factory: async_sessionmaker[Any] | None = None) -> int:
        counts = {vid: amt for vid, amt in self._counts.items()}
        if not counts:
            return 0
        factory = session_factory or get_session_factory()
        total = 0
        async with factory() as session:
            for version_id, amount in counts.items():
                await session.execute(
                    text("UPDATE agent_versions SET download_count = download_count + :amount WHERE id = :id"),
                    {"amount": amount, "id": version_id},
                )
                total += amount
            await session.commit()
        self._remove_after_success(counts)
        return total

    def _remove_after_success(self, flushed: dict[int, int]) -> None:
        """Drop flushed counts only after they are persisted; keep any concurrent records."""
        for version_id, amount in flushed.items():
            remaining = self._counts.get(version_id, 0) - amount
            if remaining > 0:
                self._counts[version_id] = remaining
            else:
                self._counts.pop(version_id, None)
        self._drained_at = time.monotonic()

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


_buffer: DownloadCountBuffer | None = None


def get_download_buffer(interval_seconds: float = 30.0) -> DownloadCountBuffer:
    global _buffer
    if _buffer is None:
        _buffer = DownloadCountBuffer()
    _buffer.configure(interval_seconds)
    return _buffer
