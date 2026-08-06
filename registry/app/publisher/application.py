import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import User
from app.identity.repositories import SigningKeyRepository, UserRepository
from app.registry.models import Agent, AgentVersion, Namespace, NamespaceMember
from app.registry.repositories import AgentRepository, NamespaceRepository, VersionRepository
from app.schemas import (
    ActivityItem,
    NamespaceInfo,
    PackageSummary,
    PublisherOverview,
    ReviewQueueItem,
    ReviewEventItem,
    SecurityDiff,
    SecurityDiffField,
    VersionIdentity,
    VersionIdentityDetail,
    dt_iso,
)


class PublisherError(ValueError):
    pass


class NamespaceForbidden(PublisherError):
    pass


class PublisherForbidden(PublisherError):
    pass


async def _memberships(session: AsyncSession, user: User) -> list[tuple[Namespace, NamespaceMember]]:
    repo = NamespaceRepository(session)
    stmt = (
        select(Namespace, NamespaceMember)
        .join(NamespaceMember, NamespaceMember.namespace_id == Namespace.id)
        .where(NamespaceMember.user_id == user.id)
        .order_by(Namespace.name)
    )
    result = (await session.execute(stmt)).all()
    return [(ns, member) for ns, member in result]


async def publisher_overview(session: AsyncSession, user: User) -> PublisherOverview:
    memberships = await _memberships(session, user)
    namespace_count = len(memberships)
    package_count = 0
    pending_scans = 0
    flagged_versions = 0
    version_repo = VersionRepository(session)
    for ns, _ in memberships:
        agents = await AgentRepository(session).all_in_namespace(ns.name)
        package_count += len(agents)
        for agent in agents:
            for ver in await version_repo.list_for(agent):
                if ver.security_status == "pending":
                    pending_scans += 1
                if ver.security_status == "flagged":
                    flagged_versions += 1

    publishes_used, publishes_limit, unlimited = await _publish_quota_status(session, user)
    keys = await SigningKeyRepository(session).for_user(user.id)
    sessions = await _active_session_count(session, user)
    return PublisherOverview(
        namespaceCount=namespace_count,
        packageCount=package_count,
        keyCount=len(keys),
        activeSessions=sessions,
        publishesUsed=publishes_used,
        publishesLimit=publishes_limit,
        publishesUnlimited=unlimited,
        pendingScans=pending_scans,
        flaggedVersions=flagged_versions,
    )


async def _active_session_count(session: AsyncSession, user: User) -> int:
    from app.identity.repositories import SessionRepository

    rows = await SessionRepository(session).for_user(user.id)
    return sum(1 for row in rows if row.revoked_at is None)


async def _publish_quota_status(session: AsyncSession, user: User) -> tuple[int, int, bool]:
    settings = get_settings()
    created = user.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - created).days >= settings.publish_quota_new_account_days:
        return 0, settings.publish_quota_new_account_daily, True
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    used = await AuditRepository(session).count_by_action(actor_id=user.id, action="version.published", since=since)
    return used, settings.publish_quota_new_account_daily, False


async def publisher_namespaces(session: AsyncSession, user: User) -> list[NamespaceInfo]:
    result: list[NamespaceInfo] = []
    for ns, member in await _memberships(session, user):
        members = (
            await session.execute(select(NamespaceMember).where(NamespaceMember.namespace_id == ns.id))
        ).scalars().all()
        agents = await AgentRepository(session).all_in_namespace(ns.name)
        result.append(
            NamespaceInfo(
                name=ns.name,
                role=member.role,
                memberCount=len(members),
                packageCount=len(agents),
                createdAt=dt_iso(ns.created_at),
            )
        )
    return result


async def publisher_packages(session: AsyncSession, user: User) -> list[PackageSummary]:
    version_repo = VersionRepository(session)
    result: list[PackageSummary] = []
    for ns, _ in await _memberships(session, user):
        for agent in await AgentRepository(session).all_in_namespace(ns.name):
            latest = await version_repo.latest(agent)
            if latest is None:
                continue
            blocked = _blocked_reason(latest)
            result.append(
                PackageSummary(
                    namespace=agent.namespace,
                    name=agent.name,
                    version=latest.version,
                    digest=latest.sha256,
                    author=agent.author,
                    description=agent.description,
                    license=agent.license,
                    publishedAt=dt_iso(latest.published_at),
                    downloads=latest.download_count,
                    trust="untrusted" if latest.security_status == "flagged" else "unknown",
                    reviewStatus=latest.review_status,
                    securityStatus=latest.security_status,
                    yanked=latest.yanked,
                    blocked=blocked,
                    signerFingerprint=latest.signature.get("publicKeyId"),
                )
            )
    return result


def _blocked_reason(ver: AgentVersion) -> str | None:
    if ver.review_status in ("rejected", "revoked"):
        return f"version is {ver.review_status}: {ver.review_reason or 'no reason recorded'}"
    if ver.security_status == "flagged":
        return "version was flagged by the security scan"
    return None


async def require_namespace_member(session: AsyncSession, user: User, namespace: str) -> Namespace:
    ns = await NamespaceRepository(session).by_name(namespace)
    if ns is None:
        raise NamespaceForbidden(f"namespace '{namespace}' not found")
    member = await NamespaceRepository(session).is_member(ns, user.id)
    if member is None:
        raise NamespaceForbidden(f"you are not a member of namespace '{namespace}'")
    return ns


async def publisher_version_identity(
    session: AsyncSession, user: User, namespace: str, name: str, version: str
) -> VersionIdentityDetail:
    await require_namespace_member(session, user, namespace)
    agent = await AgentRepository(session).by_namespace_name(namespace, name)
    if agent is None:
        raise PublisherError("agent not found")
    version_repo = VersionRepository(session)
    ver = await version_repo.by_agent_and_version(agent, version)
    if ver is None:
        raise PublisherError("version not found")

    publisher = await UserRepository(session).by_id(ver.published_by_id)
    previous = await _previous_version(session, agent, ver)
    diff = _security_diff(previous, ver)

    history: list[ReviewEventItem] = []
    events = await version_repo.reviews_for(ver)
    reviewers: dict[int, str] = {}
    for event in events:
        reviewer_name = reviewers.get(event.reviewer_id)
        if reviewer_name is None:
            reviewer = await UserRepository(session).by_id(event.reviewer_id)
            reviewer_name = reviewer.username if reviewer else "unknown"
            reviewers[event.reviewer_id] = reviewer_name
        history.append(
            ReviewEventItem(
                action=event.action,
                reason=event.reason,
                notes=event.notes,
                reviewer=reviewer_name,
                createdAt=dt_iso(event.created_at),
                digest=event.digest,
                signerFingerprint=event.signer_fingerprint,
            )
        )

    blocked = _blocked_reason(ver)
    identity = VersionIdentity(
        namespace=agent.namespace,
        name=agent.name,
        version=ver.version,
        digest=ver.sha256,
        signerFingerprint=ver.signature.get("publicKeyId"),
        publishedAt=dt_iso(ver.published_at),
        publishedBy=publisher.username if publisher else "unknown",
        downloadCount=ver.download_count,
        trust="untrusted" if ver.security_status == "flagged" else "unknown",
        reviewStatus=ver.review_status,
        reviewReason=ver.review_reason,
        securityStatus=ver.security_status,
        securityFindings=ver.security_findings,
        yanked=ver.yanked,
        blocked=blocked is not None,
        blockedReason=blocked,
    )
    return VersionIdentityDetail(identity=identity, manifest=ver.manifest, securityDiff=diff, reviewHistory=history)


async def _previous_version(session: AsyncSession, agent: Agent, ver: AgentVersion) -> AgentVersion | None:
    all_versions = await VersionRepository(session).all_for_agent(agent)
    predecessors = [v for v in all_versions if v.id != ver.id and (v.published_at, v.id) < (ver.published_at, ver.id)]
    if not predecessors:
        return None
    return max(predecessors, key=lambda v: (v.published_at, v.id))


async def publisher_activity(session: AsyncSession, user: User) -> list[ActivityItem]:
    rows = await AuditRepository(session).recent_for_actor(actor_id=user.id, limit=20)
    return [
        ActivityItem(action=row.action, detail=row.detail, createdAt=dt_iso(row.created_at))
        for row in rows
    ]


def _list_sorted(value) -> list[str]:
    if isinstance(value, list):
        return sorted(str(v) for v in value)
    return []


def _security_diff(previous: AgentVersion | None, current: AgentVersion) -> SecurityDiff:
    prev_manifest = previous.manifest if previous is not None else {}
    cur_manifest = current.manifest

    def _manifest_value(manifest: dict, key: str):
        return manifest.get(key)

    prev_perms = _list_sorted(_manifest_value(prev_manifest, "permissions"))
    cur_perms = _list_sorted(_manifest_value(cur_manifest, "permissions"))
    prev_secrets = _list_sorted(_manifest_value(prev_manifest, "secrets"))
    cur_secrets = _list_sorted(_manifest_value(cur_manifest, "secrets"))

    fields: list[SecurityDiffField] = []

    def _delta(label: str, prev, cur) -> None:
        if prev != cur:
            fields.append(SecurityDiffField(field=label, previous=prev, current=cur))

    _delta("permissions", json.dumps(prev_perms), json.dumps(cur_perms))
    _delta("secrets", json.dumps(prev_secrets), json.dumps(cur_secrets))
    _delta("runtime", json.dumps(_manifest_value(prev_manifest, "runtime"), sort_keys=True), json.dumps(_manifest_value(cur_manifest, "runtime"), sort_keys=True))
    _delta("interfaces", json.dumps(_manifest_value(prev_manifest, "interfaces"), sort_keys=True), json.dumps(_manifest_value(cur_manifest, "interfaces"), sort_keys=True))
    _delta("dependencies", json.dumps(_manifest_value(prev_manifest, "dependencies"), sort_keys=True), json.dumps(_manifest_value(cur_manifest, "dependencies"), sort_keys=True))
    _delta("models", json.dumps(_manifest_value(prev_manifest, "models"), sort_keys=True), json.dumps(_manifest_value(cur_manifest, "models"), sort_keys=True))
    _delta("framework", json.dumps(_manifest_value(prev_manifest, "framework"), sort_keys=True), json.dumps(_manifest_value(cur_manifest, "framework"), sort_keys=True))

    _delta(
        "signer",
        previous.signature.get("publicKeyId") if previous is not None else None,
        current.signature.get("publicKeyId"),
    )
    if previous is None:
        _delta("published", "(none)", "(first version)")
    elif previous.sha256 != current.sha256:
        _delta("digest", previous.sha256, current.sha256)

    return SecurityDiff(
        fields=fields,
        addedPermissions=[p for p in cur_perms if p not in prev_perms],
        removedPermissions=[p for p in prev_perms if p not in cur_perms],
        addedSecrets=[s for s in cur_secrets if s not in prev_secrets],
        removedSecrets=[s for s in prev_secrets if s not in cur_secrets],
    )


async def admin_review_queue(session: AsyncSession, user: User) -> list[ReviewQueueItem]:
    version_repo = VersionRepository(session)
    rows = await version_repo.pending_reviews()
    items: list[ReviewQueueItem] = []
    for ver in rows:
        agent = ver.agent
        publisher = await UserRepository(session).by_id(agent.owner_id)
        permissions = list(ver.manifest.get("permissions", []) or [])
        secrets = list(ver.manifest.get("secrets", []) or [])
        risk = _risk_score(ver)
        items.append(
            ReviewQueueItem(
                id=ver.id,
                namespace=agent.namespace,
                name=agent.name,
                version=ver.version,
                digest=ver.sha256,
                publishedAt=dt_iso(ver.published_at),
                publisher=publisher.username if publisher else "unknown",
                signerFingerprint=ver.signature.get("publicKeyId"),
                reviewStatus=ver.review_status,
                securityStatus=ver.security_status,
                riskScore=risk,
                permissions=permissions,
                secrets=secrets,
                downloads=ver.download_count,
            )
        )
    items.sort(key=lambda i: (-i.riskScore, i.publishedAt))
    return items


def _risk_score(ver: AgentVersion) -> int:
    score = 0
    permissions = list(ver.manifest.get("permissions", []) or [])
    secrets = list(ver.manifest.get("secrets", []) or [])
    score += len(permissions) * 10
    score += len(secrets) * 20
    if ver.security_status == "flagged":
        score += 200
    if ver.yanked:
        score += 50
    published = ver.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    age_hours = max(0, (datetime.now(timezone.utc) - published).total_seconds() / 3600)
    if age_hours < 24:
        score += 60
    elif age_hours < 168:
        score += 20
    return score
