import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.crypto import SignatureError, sha256_hex, verify_signature
from app.entitlements.application import check_publish_quota
from app.identity.models import SigningKey, User
from app.identity.repositories import SigningKeyRepository, UserRepository
from app.outbox.repositories import OutboxRepository
from app.registry.access import (
    VISIBILITIES,
    can_manage_access,
    can_view,
)
from app.registry.models import Agent, AgentVersion, BLOCKED_REVIEW_STATUSES, Namespace
from app.registry.repositories import (
    AgentRepository,
    CatalogRepository,
    GrantRepository,
    NamespaceRepository,
    VersionRepository,
)
from app.registry.signed_urls import issue_download_token, verify_download_token
from app.schemas import AgentSummary, AgentVersionDetail, RevocationItem, SignatureFile, SecurityReport, SignerKeyInfo, dt_iso
from app.security_review.adapters import RegistryScanStore
from app.security_review.application import ScanTarget, run_scan
from app.security_review.scanning import manifest_from_archive, validate_manifest_schema
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


class SigningKeyForbidden(RegistryError):
    pass


class NamespaceForbidden(RegistryError):
    pass


class NamespaceReserved(RegistryError):
    pass


class NamespaceConflict(RegistryError):
    pass


class NamespaceNotFound(RegistryError):
    pass


class MaintainerNotFound(RegistryError):
    pass


class VersionBlocked(RegistryError):
    pass


class ScanInProgress(RegistryError):
    pass


REVIEW_ACTIONS = ("verify", "warning", "reject", "revoke", "request")
REVIEW_STATUS_BY_ACTION = {
    "verify": "verified",
    "warning": "warning",
    "reject": "rejected",
    "revoke": "revoked",
    "request": "changes_requested",
}


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


def _detail(version: AgentVersion, agent: Agent, signer_key: SigningKey | None) -> AgentVersionDetail:
    signer_info = SignerKeyInfo.from_key(signer_key) if signer_key is not None else None
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
        yanked=version.yanked,
        signerKey=signer_info,
        reviewStatus=version.review_status,
        reviewedAt=dt_iso(version.reviewed_at) if version.reviewed_at else None,
        reviewReason=version.review_reason,
    )


async def _signer_key(session: AsyncSession, version: AgentVersion) -> SigningKey | None:
    fingerprint = version.signature.get("publicKeyId")
    if not fingerprint:
        return None
    return await SigningKeyRepository(session).by_fingerprint(fingerprint)


async def _resolve_version(session: AsyncSession, agent: Agent, version: str) -> AgentVersion | None:
    repo = VersionRepository(session)
    if version == "latest":
        return await repo.latest(agent)
    return await repo.by_agent_and_version(agent, version)


async def bump_catalog(session: AsyncSession) -> None:
    """Bump the catalog watermark inside a catalog-affecting transaction."""
    await CatalogRepository(session).bump()


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
    user: User | None = None,
) -> list[AgentSummary]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    agent_repo = AgentRepository(session)
    agents = await agent_repo.search(q=q, framework=framework, tags=tags, models=models, include_all=user is not None)
    latest = await agent_repo.latest_visible_versions()
    visible: list[Agent] = []
    for agent in agents:
        if not await can_view(session, agent, user):
            continue
        visible.append(agent)
    items: list[AgentSummary] = []
    for agent in visible:
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


async def get_agent_summary(session: AsyncSession, namespace: str, name: str, user: User | None = None) -> AgentSummary:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None or not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    ver = await VersionRepository(session).latest(agent)
    if ver is None:
        raise AgentNotFound("agent has no published versions")
    return _summary(agent, ver, ver.download_count)


async def list_versions(session: AsyncSession, namespace: str, name: str, user: User | None = None) -> list[str]:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None or not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    vers = await VersionRepository(session).list_for(agent)
    return [v.version for v in vers]


async def get_version_detail(
    session: AsyncSession, namespace: str, name: str, version: str, user: User | None = None
) -> AgentVersionDetail:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None or not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    signer = await _signer_key(session, ver)
    return _detail(ver, agent, signer)


def _blocked_download_reason(ver: AgentVersion) -> str | None:
    if ver.review_status in BLOCKED_REVIEW_STATUSES:
        return f"version is {ver.review_status}: {ver.review_reason or 'no reason recorded'}"
    if ver.security_status == "flagged":
        return "version was flagged by the security scan"
    return None


async def download_archive(
    session: AsyncSession, namespace: str, name: str, version: str, user: User | None = None
) -> tuple[bytes, int, int | None]:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None or not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    blocked = _blocked_download_reason(ver)
    if blocked is not None:
        raise VersionBlocked(blocked)
    data = await ArchiveStore().get(namespace, name, ver.version)
    if data is None:
        raise ArchiveMissing("archive missing on server")
    return data, ver.id, agent.organization_id


async def download_archive_via_token(
    session: AsyncSession, namespace: str, name: str, version: str, token: str
) -> tuple[bytes, int, int | None]:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    ok, _ = verify_download_token(
        token,
        namespace=namespace,
        name=name,
        version=ver.version,
        digest=ver.sha256,
        version_id=ver.id,
    )
    if not ok:
        raise AgentNotFound("agent not found")
    blocked = _blocked_download_reason(ver)
    if blocked is not None:
        raise VersionBlocked(blocked)
    data = await ArchiveStore().get(namespace, name, ver.version)
    if data is None:
        raise ArchiveMissing("archive missing on server")
    return data, ver.id, agent.organization_id


class DownloadUrlError(ValueError):
    pass


async def issue_download_url(
    session: AsyncSession, namespace: str, name: str, version: str, user: User | None, base_url: str
) -> dict:
    if user is None:
        raise DownloadUrlError("authentication required to issue a download URL")
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None or not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    blocked = _blocked_download_reason(ver)
    if blocked is not None:
        raise VersionBlocked(blocked)

    settings = get_settings()
    token = issue_download_token(
        namespace=namespace,
        name=name,
        version=ver.version,
        version_id=ver.id,
        digest=ver.sha256,
        ttl_seconds=settings.download_url_ttl_seconds,
    )
    url = (
        f"{base_url.rstrip('/')}/api/v1/agents/{namespace}/{name}"
        f"/versions/{ver.version}/archive?dl={token}"
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="package.download_url_issued",
        target_type="agent_version",
        target_id=ver.id,
        organization_id=agent.organization_id,
        namespace=namespace,
        name=name,
        detail={"namespace": namespace, "name": name, "version": ver.version},
    )
    return {"url": url, "expiresInSeconds": settings.download_url_ttl_seconds, "version": ver.version}


def _is_reserved_namespace(name: str) -> bool:
    settings = get_settings()
    lowered = name.lower()
    return any(
        lowered == prefix.rstrip("-") or lowered.startswith(prefix)
        for prefix in settings.reserved_namespace_prefixes.split(",")
        if prefix
    )


async def _check_signing_key(session: AsyncSession, user: User, sig: SignatureFile) -> SigningKey:
    key = await SigningKeyRepository(session).by_fingerprint(sig.publicKeyId)
    if key is None:
        raise SigningKeyForbidden("signature key is not registered to this registry")
    if key.user_id != user.id:
        raise SigningKeyForbidden("signature key is not registered to your account")
    now = datetime.now(timezone.utc)
    if key.revoked_at is not None:
        raise SigningKeyForbidden("signature key has been revoked")
    if key.expires_at is not None and key.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise SigningKeyForbidden("signature key has expired")
    key.last_used_at = now
    return key


async def _resolve_publish_namespace(session: AsyncSession, user: User, namespace: str) -> Namespace:
    repo = NamespaceRepository(session)
    ns = await repo.by_name(namespace)
    if ns is None:
        if _is_reserved_namespace(namespace):
            raise NamespaceReserved(f"namespace '{namespace}' is reserved")
        ns = await repo.create(name=namespace, owner_id=user.id)
        await AuditRepository(session).record(
            actor_id=user.id,
            action="namespace.claimed",
            target_type="namespace",
            target_id=ns.id,
            detail={"name": namespace},
        )
        return ns
    member = await repo.is_member(ns, user.id)
    if member is None:
        raise NamespaceForbidden(f"you are not a member of namespace '{namespace}'")
    return ns


async def publish_version(
    session: AsyncSession,
    user: User,
    *,
    namespace: str,
    name: str,
    version: str,
    archive_data: bytes,
    signature_raw: bytes,
    visibility: str = "public",
    organization_slug: str | None = None,
) -> PublishResult:
    settings = get_settings()
    if visibility not in VISIBILITIES:
        raise RegistryError(f"visibility must be one of {', '.join(VISIBILITIES)}")
    if len(archive_data) > settings.max_archive_bytes:
        raise ArchiveTooLarge("archive too large")
    if len(signature_raw) > 1024 * 1024:
        raise ArchiveTooLarge("signature file too large")

    try:
        sig = SignatureFile(**json.loads(signature_raw))
    except Exception as exc:  # noqa: BLE001
        raise InvalidSignatureFile(f"invalid signature file: {exc}") from exc

    await _check_signing_key(session, user, sig)

    try:
        verify_signature(sig, archive_data)
    except SignatureError as exc:
        raise InvalidPayload(str(exc)) from exc

    manifest_name = sig.name
    if manifest_name != f"{namespace}/{name}":
        raise InvalidPayload("signature name does not match route")
    if sig.version != version:
        raise InvalidPayload("signature version does not match route")

    try:
        manifest = manifest_from_archive(archive_data)
        validate_manifest_schema(manifest)
    except ValueError as exc:
        raise InvalidPayload(str(exc)) from exc
    if manifest.get("name") != manifest_name or manifest.get("version") != version:
        raise InvalidPayload("manifest does not match signature")

    await check_publish_quota(session, user)
    await _resolve_publish_namespace(session, user, namespace)

    organization_id: int | None = None
    if visibility == "internal":
        from app.organizations.repositories import OrganizationRepository

        if not organization_slug:
            raise RegistryError("internal visibility requires an organizationSlug")
        org = await OrganizationRepository(session).by_slug(organization_slug)
        if org is None:
            raise RegistryError(f"organization '{organization_slug}' not found")
        member = await OrganizationRepository(session).membership(org, user.id)
        if member is None or member.role not in ("owner", "administrator"):
            raise RegistryError(
                "you must be an owner or administrator of that organization to publish internally"
            )
        organization_id = org.id

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
            visibility=visibility,
            author=manifest.get("author", user.username),
            description=manifest.get("description", ""),
            license=manifest.get("license", ""),
            framework=framework,
            models=list(manifest.get("models", {}).get("supported", [])),
            tags=list(manifest.get("tags", [])),
        )
        if organization_id is not None:
            agent_repo.bind_organization(agent, organization_id)
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
        if organization_id is not None:
            agent_repo.bind_organization(agent, organization_id)

    if await version_repo.by_agent_and_version(agent, version) is not None:
        raise VersionConflict(f"version {version} already published (re-publish with a new version)")

    if agent.organization_id is not None:
        from app.quotas.application import QuotaExceeded as OrgQuotaBlocked
        from app.quotas import application as quota_app

        try:
            await quota_app.enforce_publish_quota(
                session, agent.organization_id, new_versions=1, new_bytes=len(archive_data)
            )
        except OrgQuotaBlocked as exc:
            raise OrgQuotaBlocked(
                exc.dimension, exc.used, exc.limit,
                message=f"{exc}; release capacity or raise the organization quota",
            ) from exc

    ver = await version_repo.create(
        agent_id=agent.id,
        version=version,
        manifest=manifest,
        sha256=sha256_hex(archive_data),
        archive_name=f"{namespace}_{name}-{version}.ahb",
        archive_bytes=len(archive_data),
        signature=sig.model_dump(),
        published_by_id=user.id,
        security_status="pending",
        security_findings=[],
    )
    version_repo.set_scan_timestamps(ver, requested=True)

    try:
        await ArchiveStore().put(namespace, name, version, archive_data)
    except ArchiveStoreError as exc:
        raise RegistryError(str(exc)) from exc

    scan_store = RegistryScanStore()
    target = ScanTarget(version_id=ver.id, namespace=namespace, name=name, version=version)
    security_status, findings = await run_scan(session, target, archive_data, settings.max_archive_bytes, scan_store)
    version_repo.set_scan_timestamps(ver, completed=True)

    await OutboxRepository(session).add_event(
        "scan.requested",
        {"version_id": ver.id, "namespace": namespace, "name": name, "version": version, "sha256": ver.sha256},
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="version.published",
        target_type="agent_version",
        target_id=ver.id,
        namespace=namespace,
        name=name,
        organization_id=agent.organization_id,
        detail={"version": version, "sha256": ver.sha256, "visibility": visibility},
    )
    await bump_catalog(session)
    return PublishResult(security=security_status, findings=findings)


async def trigger_rescan(session: AsyncSession, user: User, namespace: str, name: str, version: str) -> tuple[str, list[str]]:
    from app.security_review.application import ScanTargetMissing, rescan_version

    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise VersionNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")

    await _require_namespace_or_reviewer(session, user, namespace)
    last = ver.scan_requested_at
    cooldown = get_settings().rescan_cooldown_seconds
    if last is not None and cooldown > 0 and (datetime.now(timezone.utc) - last.replace(tzinfo=timezone.utc)).total_seconds() < cooldown:
        raise ScanInProgress("a scan was requested very recently; retry shortly")
    VersionRepository(session).set_scan_timestamps(ver, requested=True)

    try:
        status, findings = await rescan_version(
            session, namespace, name, version, get_settings().max_archive_bytes, RegistryScanStore()
        )
    except ScanTargetMissing as exc:
        raise VersionNotFound(str(exc)) from exc
    VersionRepository(session).set_scan_timestamps(ver, completed=True)
    return status, findings


async def review_version(
    session: AsyncSession,
    user: User,
    *,
    namespace: str,
    name: str,
    version: str,
    action: str,
    reason: str,
    notes: str | None,
) -> dict:
    if action not in REVIEW_ACTIONS:
        raise RegistryError(f"action must be one of {', '.join(REVIEW_ACTIONS)}")
    if not reason or len(reason) > 2000:
        raise RegistryError("a structured reason is required (max 2000 characters)")
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    if user.role != "admin" and ver.published_by_id == user.id:
        raise RegistryError("you cannot review a version you published")

    status = REVIEW_STATUS_BY_ACTION[action]
    signer = await _signer_key(session, ver)
    repo = VersionRepository(session)
    changed = repo.set_review(ver, status=status, reason=reason, reviewer_id=user.id)
    await repo.record_review_event(
        version=ver,
        action=action,
        reason=reason,
        notes=notes,
        reviewer_id=user.id,
        digest=ver.sha256,
        signer_fingerprint=signer.fingerprint if signer is not None else None,
    )
    await AuditRepository(session).record(
        actor_id=user.id,
        action="version.reviewed",
        target_type="agent_version",
target_id=ver.id,
            namespace=namespace,
            name=name,
            organization_id=agent.organization_id,
            detail={"namespace": namespace, "name": name, "version": version, "action": action, "status": status},
    )
    await bump_catalog(session)
    return {
        "namespace": namespace,
        "name": name,
        "version": version,
        "action": action,
        "status": status,
        "changed": changed,
    }


async def get_revocation_feed(session: AsyncSession) -> list[RevocationItem]:
    repo = VersionRepository(session)
    items: list[RevocationItem] = []
    for ver in await repo.blocked_versions():
        agent = ver.agent
        blocked = _blocked_download_reason(ver)
        if blocked is None:
            continue
        items.append(
            RevocationItem(
                namespace=agent.namespace,
                name=agent.name,
                version=ver.version,
                digest=ver.sha256,
                reason=blocked,
                reviewStatus=ver.review_status,
                securityStatus=ver.security_status,
                updatedAt=dt_iso(ver.reviewed_at or ver.published_at),
            )
        )
    return items


async def claim_namespace(session: AsyncSession, user: User, name: str) -> Namespace:
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", name) or len(name) > 64:
        raise RegistryError("namespace must be a lowercase slug of at most 64 characters")
    if _is_reserved_namespace(name):
        raise NamespaceReserved(f"namespace '{name}' is reserved")
    repo = NamespaceRepository(session)
    if await repo.by_name(name) is not None:
        raise NamespaceConflict(f"namespace '{name}' already exists")
    ns = await repo.create(name=name, owner_id=user.id)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="namespace.claimed",
        target_type="namespace",
        target_id=ns.id,
        detail={"name": name},
    )
    return ns


async def add_namespace_maintainer(
    session: AsyncSession, user: User, namespace: str, username: str, role: str
) -> dict:
    if role not in ("owner", "maintainer"):
        raise RegistryError("role must be 'owner' or 'maintainer'")
    repo = NamespaceRepository(session)
    ns = await repo.by_name(namespace)
    if ns is None:
        raise NamespaceNotFound(f"namespace '{namespace}' not found")
    actor_member = await repo.is_member(ns, user.id)
    if actor_member is None or actor_member.role != "owner":
        raise NamespaceForbidden(f"only the owner of '{namespace}' can manage maintainers")
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise MaintainerNotFound(f"user '{username}' not found")
    if await repo.is_member(ns, target.id) is not None:
        raise NamespaceConflict(f"user '{username}' is already a member")
    member = await repo.add_member(ns, target.id, role)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="namespace.maintainer.added",
        target_type="namespace_member",
        target_id=member.id,
        detail={"namespace": namespace, "username": username, "role": role},
    )
    return {"namespace": namespace, "username": username, "role": role}


async def yank_version(session: AsyncSession, user: User, namespace: str, name: str, version: str, yanked: bool) -> bool:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise VersionNotFound("version not found")
    await _require_namespace_or_reviewer(session, user, namespace, owner_only=True)
    changed = VersionRepository(session).set_yanked(ver, yanked)
    if changed:
        await AuditRepository(session).record(
            actor_id=user.id,
            action="version.yanked" if yanked else "version.unyanked",
            target_type="agent_version",
            target_id=ver.id,
            namespace=namespace,
            name=name,
            organization_id=agent.organization_id,
            detail={"namespace": namespace, "name": name, "version": version},
        )
        await bump_catalog(session)
    return changed


async def set_package_visibility(
    session: AsyncSession,
    user: User,
    namespace: str,
    name: str,
    visibility: str,
    organization_slug: str | None = None,
) -> dict:
    if visibility not in VISIBILITIES:
        raise RegistryError(f"visibility must be one of {', '.join(VISIBILITIES)}")
    agent_repo = AgentRepository(session)
    agent = await agent_repo.by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    if not await can_manage_access(session, agent, user):
        raise RegistryError("you are not authorized to manage this package")

    organization_id = None
    if visibility in ("private", "internal"):
        if organization_slug:
            from app.organizations.repositories import OrganizationRepository

            org = await OrganizationRepository(session).by_slug(organization_slug)
            if org is None:
                raise RegistryError(f"organization '{organization_slug}' not found")
            member = await OrganizationRepository(session).membership(org, user.id)
            if member is None or member.role not in ("owner", "administrator"):
                raise RegistryError("you are not an owner or administrator of that organization")
            organization_id = org.id
        elif visibility == "internal":
            raise RegistryError("internal packages must be bound to an organization")
        else:
            organization_id = agent.organization_id
    else:
        organization_id = None

    previous_org = agent.organization_id
    changed = agent_repo.set_visibility(agent, visibility)
    agent_repo.bind_organization(agent, organization_id)
    if changed:
        if organization_id is not None and organization_id != previous_org:
            from app.quotas.application import QuotaExceeded as QuotaBlocked
            from app.quotas import application as quota_app

            try:
                await quota_app.enforce_publish_quota(session, organization_id, new_versions=0)
            except QuotaBlocked as exc:
                raise RegistryError(str(exc)) from exc
        await AuditRepository(session).record(
            actor_id=user.id,
            action="package.visibility_changed",
            target_type="agent",
            target_id=agent.id,
            organization_id=organization_id,
            namespace=namespace,
            name=name,
            detail={"namespace": namespace, "name": name, "visibility": visibility},
        )
        await bump_catalog(session)
    return {"namespace": namespace, "name": name, "visibility": visibility}


async def list_package_grants(
    session: AsyncSession, user: User, namespace: str, name: str
) -> list[dict]:
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    if not await can_manage_access(session, agent, user):
        raise RegistryError("you are not authorized to manage this package")
    grants = await GrantRepository(session).for_agent(agent)
    return [
        {
            "id": g.id,
            "type": "user" if g.user_id is not None else "team",
            "userId": g.user_id,
            "teamId": g.team_id,
            "grantedBy": g.granted_by_id,
            "createdAt": dt_iso(g.created_at),
        }
        for g in grants
    ]


async def grant_package_access(
    session: AsyncSession,
    user: User,
    namespace: str,
    name: str,
    *,
    username: str | None = None,
    team_id: int | None = None,
) -> dict:
    if (username is None) == (team_id is None):
        raise RegistryError("provide exactly one of username or teamId")
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    if agent.visibility != "private":
        raise RegistryError("grants are only meaningful for private packages")
    if not await can_manage_access(session, agent, user):
        raise RegistryError("you are not authorized to manage this package")

    repo = GrantRepository(session)
    if username is not None:
        target = await UserRepository(session).by_username(username)
        if target is None:
            raise RegistryError(f"user '{username}' not found")
        if await repo.user_grant(agent, target.id) is not None:
            raise RegistryError(f"user '{username}' already has access")
        row = await repo.grant_user(agent, target.id, user.id)
        detail = {"namespace": namespace, "name": name, "username": username}
    else:
        if await repo.team_grant(agent, team_id) is not None:
            raise RegistryError("team already has access")
        row = await repo.grant_team(agent, team_id, user.id)
        detail = {"namespace": namespace, "name": name, "teamId": team_id}
    await AuditRepository(session).record(
        actor_id=user.id,
        action="package.access_granted",
        target_type="agent_grant",
        target_id=row.id,
        organization_id=agent.organization_id,
        namespace=namespace,
        name=name,
        detail=detail,
    )
    return {"username": username, "teamId": team_id, "agent": f"{namespace}/{name}"}


async def revoke_package_access(
    session: AsyncSession,
    user: User,
    namespace: str,
    name: str,
    *,
    username: str | None = None,
    team_id: int | None = None,
) -> dict:
    if (username is None) == (team_id is None):
        raise RegistryError("provide exactly one of username or teamId")
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    if not await can_manage_access(session, agent, user):
        raise RegistryError("you are not authorized to manage this package")
    repo = GrantRepository(session)
    if username is not None:
        target = await UserRepository(session).by_username(username)
        if target is None:
            raise RegistryError(f"user '{username}' not found")
        grant = await repo.user_grant(agent, target.id)
        detail = {"namespace": namespace, "name": name, "username": username}
    else:
        grant = await repo.team_grant(agent, team_id)
        detail = {"namespace": namespace, "name": name, "teamId": team_id}
    if grant is None:
        raise RegistryError("no matching grant to revoke")
    await repo.revoke_grant(grant)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="package.access_revoked",
        target_type="agent_grant",
        target_id=grant.id,
        organization_id=agent.organization_id,
        namespace=namespace,
        name=name,
        detail=detail,
    )
    return {"username": username, "teamId": team_id, "agent": f"{namespace}/{name}"}


async def _require_namespace_or_reviewer(session: AsyncSession, user: User, namespace: str, *, owner_only: bool = False) -> None:
    repo = NamespaceRepository(session)
    ns = await repo.by_name(namespace)
    member = await repo.is_member(ns, user.id) if ns is not None else None
    if owner_only:
        owns = member is not None and member.role == "owner"
        if not owns and user.role not in ("reviewer", "admin"):
            raise RegistryError("only a namespace owner or reviewer/admin can do that")
        return
    if member is None and user.role not in ("reviewer", "admin"):
        raise RegistryError("you are not a member of this namespace")


async def get_package_audit_log(
    session: AsyncSession,
    user: User,
    namespace: str,
    name: str,
    *,
    limit: int = 50,
    before_id: int | None = None,
    action: str | None = None,
) -> dict:
    """Audit trail scoped to a private package; viewers must be able to view it."""
    from app.audit.repositories import AuditRepository

    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise AgentNotFound("agent not found")
    if not await can_view(session, agent, user):
        raise AgentNotFound("agent not found")
    events = await AuditRepository(session).search(
        namespace=namespace,
        name=name,
        limit=limit,
        before_id=before_id,
        action=action,
    )
    return {
        "items": events,
        "nextCursor": events[-1].id if len(events) == limit else None,
    }
