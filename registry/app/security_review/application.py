from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.security_review.scanning import check_archive_safety


@dataclass(frozen=True)
class ScanTarget:
    version_id: int
    namespace: str
    name: str
    version: str


class ScanStore(Protocol):
    """Cross-module port: security/review reads and records scan state on versions.

    Implementations own the mapping to the registry module's version records; the
    security/review module never touches registry tables directly.
    """

    async def load_target_by_id(self, session: AsyncSession, version_id: int) -> ScanTarget | None: ...

    async def load_target_by_name(
        self, session: AsyncSession, namespace: str, name: str, version: str
    ) -> ScanTarget | None: ...

    async def load_archive(self, session: AsyncSession, target: ScanTarget) -> bytes | None: ...

    async def record(self, session: AsyncSession, target: ScanTarget, status: str, findings: list[str]) -> bool: ...


class ScanTargetMissing(ValueError):
    pass


async def run_scan(session: AsyncSession, target: ScanTarget, archive: bytes, max_bytes: int, store: ScanStore) -> tuple[str, list[str]]:
    findings = check_archive_safety(archive, max_bytes)
    status = "flagged" if findings else "clean"
    await store.record(session, target, status, findings)
    return status, findings


async def scan_version_by_id(session: AsyncSession, version_id: int, max_bytes: int, store: ScanStore) -> tuple[str, list[str]]:
    target = await store.load_target_by_id(session, version_id)
    if target is None:
        raise ScanTargetMissing(f"version {version_id} not found")
    archive = await store.load_archive(session, target)
    if archive is None:
        raise ScanTargetMissing("archive missing on server")
    return await run_scan(session, target, archive, max_bytes, store)


async def rescan_version(
    session: AsyncSession, namespace: str, name: str, version: str, max_bytes: int, store: ScanStore
) -> tuple[str, list[str]]:
    target = await store.load_target_by_name(session, namespace, name, version)
    if target is None:
        raise ScanTargetMissing("agent or version not found")
    archive = await store.load_archive(session, target)
    if archive is None:
        raise ScanTargetMissing("archive missing on server")
    return await run_scan(session, target, archive, max_bytes, store)
