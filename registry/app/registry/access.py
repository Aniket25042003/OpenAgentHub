"""Centralized package visibility and access policy (M-8.5).

Single place that answers "can this subject see/manage this package?" using
account status, organization membership, team grants, package ACL, and
package visibility. Read endpoints call ``require_can_view`` so unauthorized
callers get the same not-found response as a truly missing package.

The anonymous catalog/search surfaces stay strictly public-only: private and
internal packages are excluded in SQL before any cache lookup (see
``catalog.py``/``AgentRepository.search``), so nothing private can leak into
shared caches.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.identity.models import User
from app.organizations.repositories import OrganizationRepository
from app.registry.models import Agent
from app.registry.repositories import GrantRepository, NamespaceRepository

PUBLIC, PRIVATE, INTERNAL = "public", "private", "internal"
VISIBILITIES = (PUBLIC, PRIVATE, INTERNAL)


class PackageNotFoundError(Exception):
    pass


async def can_view(session: AsyncSession, agent: Agent, user: User | None) -> bool:
    if agent.visibility == PUBLIC:
        return True
    if user is None or user.status != "active":
        return False
    if agent.owner_id == user.id:
        return True
    if user.role in ("reviewer", "admin"):
        return True
    if agent.visibility == INTERNAL:
        if agent.organization_id is None:
            return False
        return (
            await OrganizationRepository(session).active_membership(agent.organization_id, user.id)
        ) is not None
    if agent.visibility == PRIVATE:
        grants = GrantRepository(session)
        if await grants.user_grant(agent, user.id) is not None:
            return True
        team_ids = await grants.team_ids_for_user(user.id)
        for team_id in team_ids:
            if await grants.team_grant(agent, team_id) is not None:
                return True
    return False


async def require_can_view(session: AsyncSession, agent: Agent, user: User | None) -> None:
    if not await can_view(session, agent, user):
        raise PackageNotFoundError("agent not found")


async def can_manage(session: AsyncSession, agent: Agent, user: User | None) -> bool:
    """Publisher-level control: owner of the package or owner/admin of its org/namespace."""
    if user is None or user.status != "active":
        return False
    if agent.owner_id == user.id:
        return True
    if user.role in ("reviewer", "admin"):
        return True
    if agent.organization_id is not None:
        org_repo = OrganizationRepository(session)
        org = await org_repo.by_id(agent.organization_id)
        if org is not None:
            member = await org_repo.membership(org, user.id)
            if member is not None and member.role in ("owner", "administrator"):
                return True
    ns = await NamespaceRepository(session).by_name(agent.namespace)
    if ns is not None:
        ns_member = await NamespaceRepository(session).is_member(ns, user.id)
        if ns_member is not None and ns_member.role in ("owner", "maintainer"):
            return True
    return False