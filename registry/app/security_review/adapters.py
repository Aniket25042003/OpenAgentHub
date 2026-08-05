from sqlalchemy.ext.asyncio import AsyncSession

from app.registry.models import AgentVersion
from app.registry.repositories import AgentRepository, VersionRepository
from app.security_review.application import ScanTarget
from app.store import ArchiveStore


class RegistryScanStore:
    """ScanStore adapter over registry module repositories and the archive store."""

    def __init__(self, archive_store: ArchiveStore | None = None) -> None:
        self.archive_store = archive_store or ArchiveStore()

    async def _target(self, version: AgentVersion) -> ScanTarget:
        return ScanTarget(
            version_id=version.id,
            namespace=version.agent.namespace,
            name=version.agent.name,
            version=version.version,
        )

    async def load_target_by_id(self, session: AsyncSession, version_id: int) -> ScanTarget | None:
        version = await VersionRepository(session).by_id(version_id)
        return await self._target(version) if version is not None else None

    async def load_target_by_name(
        self, session: AsyncSession, namespace: str, name: str, version: str
    ) -> ScanTarget | None:
        agent = await AgentRepository(session).by_namespace_name(namespace, name)
        if agent is None:
            return None
        ver = await VersionRepository(session).by_agent_and_version(agent, version)
        if ver is None:
            return None
        return await self._target(ver)

    async def load_archive(self, session: AsyncSession, target: ScanTarget) -> bytes | None:
        return await self.archive_store.get(target.namespace, target.name, target.version)

    async def record(self, session: AsyncSession, target: ScanTarget, status: str, findings: list[str]) -> bool:
        version = await VersionRepository(session).by_id(target.version_id)
        if version is None:
            raise ValueError(f"version {target.version_id} not found")
        return VersionRepository(session).record_scan_result(version, status, findings)
