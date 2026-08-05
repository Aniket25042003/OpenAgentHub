import json
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.crypto import SignatureError, sha256_hex, verify_signature
from app.identity.models import User
from app.outbox.repositories import OutboxRepository
from app.registry.models import Agent, AgentVersion
from app.registry.repositories import AgentRepository, VersionRepository
from app.schemas import AgentSummary, AgentVersionDetail, SignatureFile, SecurityReport, dt_iso
from app.security_review.adapters import RegistryScanStore
from app.security_review.application import ScanTarget, run_scan
from app.security_review.scanning import manifest_from_archive
from app.store import ArchiveStore, ArchiveStoreError

TRUST_DEFAULT = "unknown"


class RegistryError(ValueError):
    pass


class AgentNotFound(RegistryError):
    pass


class VersionNotFound(RegistryError):
    pass


class ArchiveMissing(RegistryError):
    pass


class VersionConflict(RegistryError):
    pass


class InvalidSignatureFile(RegistryError):
    pass


class InvalidPayload(RegistryError):
    pass


class ArchiveTooLarge(RegistryError):
    pass


@dataclass(frozen=True)
class PublishResult:
    security: str
    findings: list[str]


def _summary(agent: Agent, version: AgentVersion | None, downloads: int) -> AgentSummary:
    return AgentSummary(
        namespace=agent.namespace,
        name=agent.name,
        version=version.version if version is not None else "",
        author=agent.author,
        description=agent.description,
        license=agent.license,
        framework=agent.framework,
        models=agent.models,
        tags=agent.tags,
        downloads=downloads,
        trust=TRUST_DEFAULT if version is None else ("untrusted" if version.security_status == "flagged" else "unknown"),
    )


def _detail(version: AgentVersion, agent: Agent) -> AgentVersionDetail:
    return AgentVersionDetail(
        name=f"{agent.namespace}/{agent.name}",
        version=version.version,
        author=agent.author,
        description=agent.description,
        manifest=version.manifest,
        publishedAt=dt_iso(version.published_at),
        downloadCount=version.download_count,
        trust="untrusted" if version.security_status == "flagged" else TRUST_DEFAULT,
        signature=SignatureFile(**version.signature),
        security=SecurityReport(status=version.security_status, findings=version.security_findings),
    )


async def _resolve_version(session: AsyncSession, agent: Agent, version: str) -> AgentVersion | None:
    repo = VersionRepository(session)
    if version == "latest":
        return await repo.latest(agent)
    return await repo.by_agent_and_version(agent, version)


async def search_agents(
    session: AsyncSession,
    *,
    q: str | None,
    framework: str | None,
    tags: str | None,
    models: str | None,
    sort: str,
    limit: int,
    offset: int,
) -> list[AgentSummary]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    agent_repo = AgentRepository(session)
    agents = await agent_repo.search(q=q, framework=framework, tags=tags, models=models)
    latest = await agent_repo.latest_versions()
    items: list[AgentSummary] = []
    for agent in agents:
        ver = latest.get(agent.id)
        if ver is None:
            continue
        items.append(_summary(agent, ver, ver.download_count))
    if sort == "newest":
        items.sort(key=lambda s: s.version, reverse=True)
    elif sort == "trending":
        items.sort(key=lambda s: (s.downloads, s.version), reverse=True)
    else:
        items.sort(key=lambda s: s.downloads, reverse=True)
    return items[offset : offset + limit]


async def get_agent_summary(session: AsyncSession, namespace: str, name: str) -> AgentSummary:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await VersionRepository(session).latest(agent)
    if ver is None:
        raise AgentNotFound("agent has no published versions")
    return _summary(agent, ver, ver.download_count)


async def list_versions(session: AsyncSession, namespace: str, name: str) -> list[str]:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    vers = await VersionRepository(session).list_for(agent)
    return [v.version for v in vers]


async def get_version_detail(session: AsyncSession, namespace: str, name: str, version: str) -> AgentVersionDetail:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    return _detail(ver, agent)


async def download_archive(session: AsyncSession, namespace: str, name: str, version: str) -> bytes:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    data = await ArchiveStore().get(namespace, name, ver.version)
    if data is None:
        raise ArchiveMissing("archive missing on server")
    await VersionRepository(session).increment_download(ver)
    return data


async def publish_version(
    session: AsyncSession,
    user: User,
    *,
    namespace: str,
    name: str,
    version: str,
    archive_data: bytes,
    signature_raw: bytes,
) -> PublishResult:
    settings = get_settings()
    if len(archive_data) > settings.max_archive_bytes:
        raise ArchiveTooLarge("archive too large")
    if len(signature_raw) > 1024 * 1024:
        raise ArchiveTooLarge("signature file too large")

    try:
        sig = SignatureFile(**json.loads(signature_raw))
    except Exception as exc:  # noqa: BLE001
        raise InvalidSignatureFile(f"invalid signature file: {exc}") from exc

    try:
        verify_signature(sig, archive_data)
    except SignatureError as exc:
        raise InvalidPayload(str(exc)) from exc

    manifest_name = sig.name
    if manifest_name != f"{namespace}/{name}":
        raise InvalidPayload("signature name does not match route")
    if sig.version != version:
        raise InvalidPayload("signature version does not match route")

    manifest = manifest_from_archive(archive_data)
    if manifest.get("name") != manifest_name or manifest.get("version") != version:
        raise InvalidPayload("manifest does not match signature")

    framework_raw = manifest.get("framework")
    framework = framework_raw.get("name") if isinstance(framework_raw, dict) else framework_raw

    agent_repo = AgentRepository(session)
    version_repo = VersionRepository(session)
    agent = await agent_repo.by_namespace_name(namespace, name)
    if agent is None:
        agent = await agent_repo.create(
            namespace=namespace,
            name=name,
            owner_id=user.id,
            author=manifest.get("author", user.username),
            description=manifest.get("description", ""),
            license=manifest.get("license", ""),
            framework=framework,
            models=list(manifest.get("models", {}).get("supported", [])),
            tags=list(manifest.get("tags", [])),
        )
    else:
        agent_repo.update_metadata(
            agent,
            author=manifest.get("author", agent.author),
            description=manifest.get("description", agent.description),
            license=manifest.get("license", agent.license),
            framework=framework,
            models=list(manifest.get("models", {}).get("supported", [])),
            tags=list(manifest.get("tags", [])),
        )

    if await version_repo.by_agent_and_version(agent, version) is not None:
        raise VersionConflict(f"version {version} already published (re-publish with a new version)")

    ver = await version_repo.create(
        agent_id=agent.id,
        version=version,
        manifest=manifest,
        sha256=sha256_hex(archive_data),
        archive_name=f"{namespace}_{name}-{version}.ahb",
        signature=sig.model_dump(),
        published_by_id=user.id,
        security_status="pending",
        security_findings=[],
    )

    try:
        await ArchiveStore().put(namespace, name, version, archive_data)
    except ArchiveStoreError as exc:
        raise RegistryError(str(exc)) from exc

    scan_store = RegistryScanStore()
    target = ScanTarget(version_id=ver.id, namespace=namespace, name=name, version=version)
    security_status, findings = await run_scan(session, target, archive_data, settings.max_archive_bytes, scan_store)

    await OutboxRepository(session).add_event(
        "scan.requested",
        {"version_id": ver.id, "namespace": namespace, "name": name, "version": version, "sha256": ver.sha256},
    )
    await AuditRepository(session).record(
        actor_id=user.id, action="version.published", target_type="agent_version", target_id=ver.id
    )
    return PublishResult(security=security_status, findings=findings)


async def trigger_rescan(session: AsyncSession, namespace: str, name: str, version: str) -> tuple[str, list[str]]:
    from app.security_review.application import ScanTargetMissing, rescan_version

    try:
        return await rescan_version(
            session, namespace, name, version, get_settings().max_archive_bytes, RegistryScanStore()
        )
    except ScanTargetMissing as exc:
        raise VersionNotFound(str(exc)) from exc
