from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, aliased

from app.registry.models import (
    BLOCKED_REVIEW_STATUSES,
    Agent,
    AgentGrant,
    AgentVersion,
    CatalogMeta,
    Namespace,
    NamespaceMember,
    VersionReviewEvent,
)
from app.registry.semver import semver_key, sort_key


class NamespaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_name(self, name: str) -> Namespace | None:
        return (
            await self.session.execute(select(Namespace).where(Namespace.name == name))
        ).scalar_one_or_none()

    async def create(self, *, name: str, owner_id: int) -> Namespace:
        namespace = Namespace(name=name)
        self.session.add(namespace)
        await self.session.flush()
        self.session.add(
            NamespaceMember(namespace_id=namespace.id, user_id=owner_id, role="owner")
        )
        return namespace

    async def is_member(self, namespace: Namespace, user_id: int) -> NamespaceMember | None:
        return (
            await self.session.execute(
                select(NamespaceMember).where(
                    NamespaceMember.namespace_id == namespace.id, NamespaceMember.user_id == user_id
                )
            )
        ).scalar_one_or_none()

    async def add_member(self, namespace: Namespace, user_id: int, role: str) -> NamespaceMember:
        member = NamespaceMember(namespace_id=namespace.id, user_id=user_id, role=role)
        self.session.add(member)
        return member


class AgentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_namespace_name(self, namespace: str, name: str) -> Agent | None:
        return (
            await self.session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))
        ).scalar_one_or_none()

    async def by_id(self, agent_id: int) -> Agent | None:
        return await self.session.get(Agent, agent_id)

    async def all_in_namespace(self, namespace: str) -> list[Agent]:
        return (
            await self.session.execute(select(Agent).where(Agent.namespace == namespace).order_by(Agent.name))
        ).scalars().all()

    def set_visibility(self, agent: Agent, visibility: str) -> bool:
        if agent.visibility == visibility:
            return False
        agent.visibility = visibility
        return True

    def bind_organization(self, agent: Agent, organization_id: int | None) -> None:
        agent.organization_id = organization_id

    async def create(
        self,
        *,
        namespace: str,
        name: str,
        owner_id: int,
        author: str,
        description: str,
        license: str,
        framework: str | None,
        models: list[str],
        tags: list[str],
        visibility: str = "public",
    ) -> Agent:
        agent = Agent(
            namespace=namespace,
            name=name,
            owner_id=owner_id,
            visibility=visibility,
            author=author,
            description=description,
            license=license,
            framework=framework,
            models=models,
            tags=tags,
        )
        self.session.add(agent)
        await self.session.flush()
        return agent

    def update_metadata(self, agent: Agent, *, author: str, description: str, license: str, framework: str | None, models: list[str], tags: list[str]) -> None:
        agent.author = author
        agent.description = description
        agent.license = license
        agent.framework = framework
        agent.models = models
        agent.tags = tags

    async def search(
        self,
        *,
        q: str | None,
        framework: str | None,
        tags: str | None,
        models: str | None,
        include_internal: bool = False,
        include_all: bool = False,
    ) -> list[Agent]:
        stmt = select(Agent).where(Agent.visibility == "public")
        if include_internal:
            stmt = select(Agent).where(Agent.visibility.in_(("public", "internal")))
        if include_all:
            stmt = select(Agent).where(Agent.visibility.in_(("public", "internal", "private")))
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(
                func.lower(Agent.name).like(like) | func.lower(Agent.namespace).like(like) | func.lower(Agent.description).like(like)
            )
        if framework:
            stmt = stmt.where(Agent.framework == framework)
        if tags:
            wanted = [t.strip().lower() for t in tags.split(",") if t.strip()]
            stmt = stmt.where(Agent.tags.contains(wanted))
        if models:
            wanted = [m.strip().lower() for m in models.split(",") if m.strip()]
            stmt = stmt.where(Agent.models.contains(wanted))
        return (await self.session.execute(stmt)).scalars().all()

    async def latest_versions(self) -> dict[int, AgentVersion]:
        versions = (await self.session.execute(select(AgentVersion))).scalars().all()
        latest: dict[int, AgentVersion] = {}
        for v in versions:
            cur = latest.get(v.agent_id)
            if cur is None or (semver_key(v.version), v.published_at) > (semver_key(cur.version), cur.published_at):
                latest[v.agent_id] = v
        return latest

    async def latest_visible_versions(self) -> dict[int, AgentVersion]:
        """Latest *visible* version per agent from a single SQL window query.

        Visibility excludes yanked versions and versions whose review status
        blocks them. Ordering uses the stored collateable ``sort_key`` so the
        database (not Python) resolves "latest".
        """
        visible = ~AgentVersion.yanked & ~AgentVersion.review_status.in_(BLOCKED_REVIEW_STATUSES)
        rank = func.row_number().over(
            partition_by=AgentVersion.agent_id,
            order_by=(AgentVersion.sort_key.desc(), AgentVersion.published_at.desc(), AgentVersion.id.desc()),
        ).label("rn")
        sub = select(AgentVersion, rank).where(visible).subquery()
        latest_alias = aliased(AgentVersion, sub)
        stmt = select(latest_alias).where(sub.c.rn == 1)
        return {v.agent_id: v for v in (await self.session.execute(stmt)).scalars().all()}


class CatalogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def watermark(self) -> str:
        row = (await self.session.execute(select(CatalogMeta).where(CatalogMeta.id == 1))).scalar_one_or_none()
        return row.updated_at.isoformat() if row is not None else ""

    async def bump(self) -> None:
        from app.db import utcnow

        row = (await self.session.execute(select(CatalogMeta).where(CatalogMeta.id == 1))).scalar_one_or_none()
        if row is None:
            row = CatalogMeta(id=1)
            self.session.add(row)
        row.updated_at = utcnow()


class VersionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_id(self, version_id: int) -> AgentVersion | None:
        return (
            await self.session.execute(
                select(AgentVersion).where(AgentVersion.id == version_id).options(joinedload(AgentVersion.agent))
            )
        ).scalar_one_or_none()

    async def by_agent_and_version(self, agent: Agent, version: str) -> AgentVersion | None:
        return (
            await self.session.execute(
                select(AgentVersion).where(AgentVersion.agent_id == agent.id, AgentVersion.version == version)
            )
        ).scalar_one_or_none()

    async def latest(self, agent: Agent) -> AgentVersion | None:
        versions = (
            await self.session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id))
        ).scalars().all()
        if not versions:
            return None
        return max(versions, key=lambda v: (semver_key(v.version), v.published_at))

    async def list_for(self, agent: Agent) -> list[AgentVersion]:
        versions = (
            await self.session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id))
        ).scalars().all()
        return sorted(versions, key=lambda v: (semver_key(v.version), v.published_at), reverse=True)

    async def all_for_agent(self, agent: Agent) -> list[AgentVersion]:
        return (
            await self.session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id))
        ).scalars().all()

    async def blocked_versions(self) -> list[AgentVersion]:
        stmt = (
            select(AgentVersion)
            .where(
                AgentVersion.review_status.in_(("rejected", "revoked")) | (AgentVersion.security_status == "flagged")
            )
            .order_by(AgentVersion.reviewed_at.desc())
            .options(joinedload(AgentVersion.agent))
        )
        return (await self.session.execute(stmt)).scalars().all()

    async def pending_reviews(self) -> list[AgentVersion]:
        stmt = (
            select(AgentVersion)
            .where(AgentVersion.review_status == "pending")
            .options(joinedload(AgentVersion.agent))
        )
        return (await self.session.execute(stmt)).scalars().all()

    async def reviews_for(self, version: AgentVersion) -> list[VersionReviewEvent]:
        return (
            await self.session.execute(
                select(VersionReviewEvent).where(VersionReviewEvent.version_id == version.id)
            )
        ).scalars().all()

    async def create(
        self,
        *,
        agent_id: int,
        version: str,
        manifest: dict,
        sha256: str,
        archive_name: str,
        signature: dict,
        published_by_id: int,
        security_status: str,
        security_findings: list[str],
    ) -> AgentVersion:
        ver = AgentVersion(
            agent_id=agent_id,
            version=version,
            sort_key=sort_key(version),
            manifest=manifest,
            sha256=sha256,
            archive_name=archive_name,
            signature=signature,
            published_by_id=published_by_id,
            security_status=security_status,
            security_findings=security_findings,
        )
        self.session.add(ver)
        await self.session.flush()
        return ver

    def record_scan_result(self, version: AgentVersion, status: str, findings: list[str]) -> bool:
        if version.security_status != status or version.security_findings != findings:
            version.security_status = status
            version.security_findings = findings
            return True
        return False

    def set_yanked(self, version: AgentVersion, yanked: bool) -> bool:
        if version.yanked == yanked:
            return False
        version.yanked = yanked
        return True

    def set_scan_timestamps(self, version: AgentVersion, *, requested: bool = False, completed: bool = False) -> None:
        from app.db import utcnow

        now = utcnow()
        if requested:
            version.scan_requested_at = now
        if completed:
            version.scan_completed_at = now

    def set_review(self, version: AgentVersion, *, status: str, reason: str, reviewer_id: int) -> bool:
        if version.review_status == status and version.review_reason == reason:
            return False
        version.review_status = status
        version.review_reason = reason
        version.reviewed_by_id = reviewer_id
        version.reviewed_at = func.now()
        return True

    async def record_review_event(
        self,
        version: AgentVersion,
        *,
        action: str,
        reason: str,
        notes: str | None,
        reviewer_id: int,
        digest: str,
        signer_fingerprint: str | None,
    ) -> VersionReviewEvent:
        event = VersionReviewEvent(
            version_id=version.id,
            action=action,
            reason=reason,
            notes=notes,
            digest=digest,
            signer_fingerprint=signer_fingerprint,
            reviewer_id=reviewer_id,
        )
        self.session.add(event)
        await self.session.flush()
        return event


class GrantRepository:
    """Per-agent access grants for ``private`` visibility (direct users or teams)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def for_agent(self, agent: Agent) -> list[AgentGrant]:
        return (
            await self.session.execute(
                select(AgentGrant)
                .where(AgentGrant.agent_id == agent.id)
                .order_by(AgentGrant.created_at.desc())
            )
        ).scalars().all()

    async def user_grant(self, agent: Agent, user_id: int) -> AgentGrant | None:
        return (
            await self.session.execute(
                select(AgentGrant).where(AgentGrant.agent_id == agent.id, AgentGrant.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def team_grant(self, agent: Agent, team_id: int) -> AgentGrant | None:
        return (
            await self.session.execute(
                select(AgentGrant).where(AgentGrant.agent_id == agent.id, AgentGrant.team_id == team_id)
            )
        ).scalar_one_or_none()

    async def grant_user(self, agent: Agent, user_id: int, granted_by_id: int) -> AgentGrant:
        row = AgentGrant(agent_id=agent.id, user_id=user_id, granted_by_id=granted_by_id)
        self.session.add(row)
        await self.session.flush()
        return row

    async def grant_team(self, agent: Agent, team_id: int, granted_by_id: int) -> AgentGrant:
        row = AgentGrant(agent_id=agent.id, team_id=team_id, granted_by_id=granted_by_id)
        self.session.add(row)
        await self.session.flush()
        return row

    async def revoke_grant(self, grant: AgentGrant) -> None:
        await self.session.delete(grant)

    async def team_ids_for_user(self, user_id: int) -> set[int]:
        from app.organizations.models import TeamMember

        rows = (
            await self.session.execute(select(TeamMember.team_id).where(TeamMember.user_id == user_id))
        ).scalars().all()
        return set(rows)
