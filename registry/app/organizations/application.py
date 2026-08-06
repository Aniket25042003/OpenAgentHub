import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import User
from app.identity.repositories import UserRepository
from app.organizations.models import ORG_ROLES, Organization, OrganizationMember
from app.organizations.repositories import (
    InvitationRepository,
    OrganizationRepository,
    ServiceAccountRepository,
    TeamRepository,
)

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")


class OrganizationError(ValueError):
    status_code = 400


class OrganizationConflict(OrganizationError):
    status_code = 409


class OrganizationNotFound(OrganizationError):
    status_code = 404


class OrganizationForbidden(OrganizationError):
    status_code = 403


class InvitationError(OrganizationError):
    status_code = 400


class InvitationExpired(InvitationError):
    status_code = 410


def _membership_or_raise(
    member: OrganizationMember | None, org: Organization
) -> OrganizationMember:
    if member is None:
        raise OrganizationForbidden(f"not a member of '{org.slug}'")
    return member


def _role_or_raise(member: OrganizationMember, *roles: str) -> None:
    if member.role not in roles:
        raise OrganizationForbidden(f"requires role {', '.join(roles)} in organization")


async def create_organization(
    session: AsyncSession, user: User, slug: str, display_name: str
) -> Organization:
    slug = slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise OrganizationError(
            "slug must be 3-64 chars, lowercase alphanumeric and hyphens"
        )
    if not display_name.strip():
        raise OrganizationError("display name is required")
    repo = OrganizationRepository(session)
    if await repo.by_slug(slug) is not None:
        raise OrganizationConflict(f"organization '{slug}' already exists")
    org = await repo.create(
        slug=slug, display_name=display_name.strip(), owner_id=user.id
    )
    from app.billing.application import ensure_subscription

    await ensure_subscription(session, org.id)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.created",
        target_type="organization",
        target_id=org.id,
        organization_id=org.id,
        detail={"slug": slug},
    )
    return org


async def list_my_organizations(session: AsyncSession, user: User) -> list[dict]:
    rows = await OrganizationRepository(session).for_user(user.id)
    return [
        {
            "slug": o.slug,
            "displayName": o.display_name,
            "status": o.status,
            "role": role,
        }
        for o, role in rows
    ]


async def get_organization(session: AsyncSession, user: User, slug: str) -> dict:
    org = await OrganizationRepository(session).by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = await OrganizationRepository(session).membership(org, user.id)
    _membership_or_raise(member, org)
    members = await OrganizationRepository(session).members(org)
    return {
        "slug": org.slug,
        "displayName": org.display_name,
        "status": org.status,
        "myRole": member.role,
        "memberCount": len(members),
    }


async def update_organization(
    session: AsyncSession, user: User, slug: str, *, display_name: str | None
) -> Organization:
    org = await OrganizationRepository(session).by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(
        await OrganizationRepository(session).membership(org, user.id), org
    )
    _role_or_raise(member, "owner", "administrator")
    if display_name is not None:
        if not display_name.strip():
            raise OrganizationError("display name is required")
        org.display_name = display_name.strip()
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.updated",
        target_type="organization",
        target_id=org.id,
        organization_id=org.id,
        detail={"slug": slug},
    )
    return org


async def list_members(session: AsyncSession, user: User, slug: str) -> list[dict]:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    _membership_or_raise(await org_repo.membership(org, user.id), org)
    members = await org_repo.members(org)
    usernames = {
        u.id: u.username
        for u in await UserRepository(session).by_ids([m.user_id for m in members])
    }
    return [{"username": usernames[m.user_id], "role": m.role} for m in members]


async def add_member(
    session: AsyncSession, actor: User, slug: str, username: str, role: str
) -> dict:
    if role not in ORG_ROLES:
        raise OrganizationError(f"role must be one of {', '.join(ORG_ROLES)}")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    if role == "owner":
        _role_or_raise(member, "owner")
    elif member.role not in ("owner", "administrator", "maintainer"):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    if await org_repo.membership(org, target.id) is not None:
        raise OrganizationConflict(f"user '{username}' is already a member")
    from app.quotas.application import QuotaExceeded as QuotaBlocked
    from app.quotas import application as quota_app

    try:
        await quota_app.enforce_org_member_quota(session, org.id)
    except QuotaBlocked as exc:
        raise OrganizationError(str(exc)) from exc
    row = await org_repo.add_member(org, target.id, role)
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.member.added",
        target_type="organization_member",
        target_id=row.id,
        organization_id=org.id,
        detail={"slug": slug, "username": username, "role": role},
    )
    return {"slug": slug, "username": username, "role": role}


async def change_member_role(
    session: AsyncSession, actor: User, slug: str, username: str, role: str
) -> dict:
    if role not in ORG_ROLES:
        raise OrganizationError(f"role must be one of {', '.join(ORG_ROLES)}")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    actor_member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    target_member = await org_repo.membership(org, target.id)
    if target_member is None:
        raise OrganizationError(f"user '{username}' is not a member")
    if target_member.is_owner:
        raise OrganizationForbidden("cannot change the role of the organization owner")
    if role == "owner":
        if not actor_member.is_owner:
            raise OrganizationForbidden("only the owner can grant ownership")
        target_member.role = "owner"
        actor_member.role = "administrator"
    else:
        if not (actor_member.is_owner or actor_member.role == "administrator"):
            raise OrganizationForbidden("requires owner or administrator role")
        target_member.role = role
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.member.role_changed",
        target_type="organization_member",
        target_id=target_member.id,
        organization_id=org.id,
        detail={"slug": slug, "username": username, "role": role},
    )
    return {"slug": slug, "username": username, "role": role}


async def remove_member(
    session: AsyncSession, actor: User, slug: str, username: str
) -> dict:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    actor_member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    target_member = await org_repo.membership(org, target.id)
    if target_member is None:
        raise OrganizationError(f"user '{username}' is not a member")
    if target_member.is_owner:
        raise OrganizationForbidden("cannot remove the organization owner")
    if not (
        actor_member.is_owner
        or actor_member.role == "administrator"
        or actor_member.id == target_member.id
    ):
        raise OrganizationForbidden("requires owner or administrator role")
    await session.delete(target_member)
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.member.removed",
        target_type="organization_member",
        target_id=target_member.id,
        organization_id=org.id,
        detail={"slug": slug, "username": username},
    )
    return {"slug": slug, "username": username}


async def leave_organization(session: AsyncSession, user: User, slug: str) -> dict:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if member.is_owner:
        owners = [m for m in await org_repo.members(org) if m.is_owner]
        if len(owners) <= 1:
            raise OrganizationForbidden(
                "transfer ownership before leaving; an organization needs at least one owner"
            )
    await session.delete(member)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.member.left",
        target_type="organization_member",
        target_id=member.id,
        organization_id=org.id,
        detail={"slug": slug},
    )
    return {"slug": slug}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_invitation_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(24)
    return raw, _hash_token(raw)


async def invite_member(
    session: AsyncSession,
    actor: User,
    slug: str,
    username: str,
    role: str,
    *,
    ttl_hours: int | None = None,
) -> dict:
    if role not in ORG_ROLES:
        raise OrganizationError(f"role must be one of {', '.join(ORG_ROLES)}")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    if role == "owner":
        _role_or_raise(member, "owner")
    elif member.role not in ("owner", "administrator", "maintainer"):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    if await org_repo.membership(org, target.id) is not None:
        raise OrganizationConflict(f"user '{username}' is already a member")
    from app.quotas.application import QuotaExceeded as QuotaBlocked
    from app.quotas import application as quota_app

    try:
        await quota_app.enforce_org_member_quota(session, org.id)
    except QuotaBlocked as exc:
        raise OrganizationError(str(exc)) from exc
    settings = get_settings()
    ttl = ttl_hours or settings.invitation_ttl_hours
    raw, hashed = issue_invitation_token()
    row = await InvitationRepository(session).create(
        organization=org,
        invited_by_id=actor.id,
        role=role,
        team_id=None,
        token_hash=hashed,
        email=target.username,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None)
        + timedelta(hours=ttl),
    )
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.invitation.created",
        target_type="invitation",
        target_id=row.id,
        organization_id=org.id,
        detail={"slug": slug, "username": username, "role": role},
    )
    return {
        "slug": slug,
        "username": username,
        "role": role,
        "token": raw,
        "expiresInHours": ttl,
    }


async def accept_invitation(session: AsyncSession, user: User, token: str) -> dict:
    repo = InvitationRepository(session)
    inv = await repo.by_token_hash(_hash_token(token))
    if inv is None:
        raise InvitationError("invitation not found")
    if inv.accepted_at is not None:
        raise InvitationError("invitation already used")
    if inv.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise InvitationExpired("invitation expired")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_id(inv.organization_id)
    if org is None or org.status != "active":
        raise InvitationError("organization is not accepting members")
    if await org_repo.membership(org, user.id) is not None:
        raise OrganizationConflict("you are already a member")
    from app.quotas.application import QuotaExceeded as QuotaBlocked
    from app.quotas import application as quota_app

    try:
        await quota_app.enforce_org_member_quota(session, org.id)
    except QuotaBlocked as exc:
        raise OrganizationError(str(exc)) from exc
    await org_repo.add_member(org, user.id, inv.role)
    await repo.mark_accepted(inv, user.id)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.invitation.accepted",
        target_type="invitation",
        target_id=inv.id,
        organization_id=org.id,
        detail={"slug": org.slug, "role": inv.role},
    )
    return {"slug": org.slug, "role": inv.role}


async def list_invitations(session: AsyncSession, user: User, slug: str) -> list[dict]:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    rows = await InvitationRepository(session).for_organization(org)
    return [
        {
            "id": r.id,
            "username": r.email,
            "role": r.role,
            "expiresAt": r.expires_at.isoformat() + "Z",
            "accepted": r.accepted_at is not None,
        }
        for r in rows
    ]


async def list_teams(session: AsyncSession, user: User, slug: str) -> list[dict]:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    _membership_or_raise(await org_repo.membership(org, user.id), org)
    teams = await TeamRepository(session).list_for(org)
    return [
        {
            "id": t.id,
            "name": t.name,
            "memberCount": len(await TeamRepository(session).members(t)),
        }
        for t in teams
    ]


async def create_team(session: AsyncSession, user: User, slug: str, name: str) -> dict:
    if not name.strip() or len(name.strip()) > 64:
        raise OrganizationError("team name is required (max 64 chars)")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    team_repo = TeamRepository(session)
    if await team_repo.in_organization(org, name.strip()) is not None:
        raise OrganizationConflict(f"team '{name}' already exists")
    team = await team_repo.create(org, name.strip())
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.team.created",
        target_type="team",
        target_id=team.id,
        organization_id=org.id,
        detail={"slug": slug, "name": team.name},
    )
    return {"id": team.id, "name": team.name}


async def add_team_member(
    session: AsyncSession, user: User, slug: str, team_id: int, username: str
) -> dict:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    team_repo = TeamRepository(session)
    team = await team_repo.by_id(team_id)
    if team is None or team.organization_id != org.id:
        raise OrganizationNotFound("team not found")
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    if await org_repo.membership(org, target.id) is None:
        raise OrganizationError(f"user '{username}' is not a member of '{slug}'")
    if await team_repo.membership(team, target.id) is not None:
        raise OrganizationConflict(
            f"user '{username}' is already on team '{team.name}'"
        )
    await team_repo.add_member(team, target.id)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.team.member.added",
        target_type="team_member",
        target_id=team.id,
        organization_id=org.id,
        detail={"slug": slug, "team": team.name, "username": username},
    )
    return {"slug": slug, "team": team.name, "username": username}


async def remove_team_member(
    session: AsyncSession, user: User, slug: str, team_id: int, username: str
) -> dict:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    team_repo = TeamRepository(session)
    team = await team_repo.by_id(team_id)
    if team is None or team.organization_id != org.id:
        raise OrganizationNotFound("team not found")
    target = await UserRepository(session).by_username(username)
    if target is None:
        raise OrganizationError(f"user '{username}' not found")
    tm = await team_repo.membership(team, target.id)
    if tm is None:
        raise OrganizationError(f"user '{username}' is not on team '{team.name}'")
    await session.delete(tm)
    await AuditRepository(session).record(
        actor_id=user.id,
        action="organization.team.member.removed",
        target_type="team_member",
        target_id=team.id,
        organization_id=org.id,
        detail={"slug": slug, "team": team.name, "username": username},
    )
    return {"slug": slug, "team": team.name, "username": username}


SERVICE_ACCOUNT_ROLES = tuple(r for r in ORG_ROLES if r != "owner")


async def create_service_account(
    session: AsyncSession, actor: User, slug: str, *, name: str, role: str
) -> dict:
    if not name.strip() or len(name.strip()) > 64:
        raise OrganizationError("service account name is required (max 64 chars)")
    if role not in SERVICE_ACCOUNT_ROLES:
        raise OrganizationError(f"role must be one of {', '.join(SERVICE_ACCOUNT_ROLES)}")
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    sa_repo = ServiceAccountRepository(session)
    if await sa_repo.in_organization(org, name.strip()) is not None:
        raise OrganizationConflict(f"service account '{name}' already exists")
    from app.quotas.application import QuotaExceeded as QuotaBlocked
    from app.quotas import application as quota_app

    try:
        await quota_app.enforce_service_account_quota(session, org.id)
    except QuotaBlocked as exc:
        raise OrganizationError(str(exc)) from exc
    from app.identity.models import User

    user = await UserRepository(session).by_username(f"svc-{slug}-{name.strip().lower().replace(' ', '-')}")
    if user is not None:
        raise OrganizationConflict(f"a user for service account '{name}' already exists")
    username = f"svc-{slug}-{name.strip().lower().replace(' ', '-')}"
    identity = User(username=username, role="publisher")
    session.add(identity)
    await session.flush()
    await org_repo.add_member(org, identity.id, role)
    row = await sa_repo.create(organization=org, user_id=identity.id, name=name.strip(), created_by_id=actor.id)
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.service_account.created",
        target_type="service_account",
        target_id=row.id,
        organization_id=org.id,
        detail={"slug": slug, "name": row.name, "role": role},
    )
    return {"slug": slug, "name": row.name, "role": role, "id": row.id}


async def list_service_accounts(session: AsyncSession, user: User, slug: str) -> list[dict]:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    rows = await ServiceAccountRepository(session).for_organization(org)
    users = {
        u.id: u
        for u in await UserRepository(session).by_ids([r.user_id for r in rows])
    }
    return [
        {
            "id": r.id,
            "name": r.name,
            "status": r.status,
            "username": users[r.user_id].username,
            "role": (await org_repo.membership(org, r.user_id)).role if await org_repo.membership(org, r.user_id) else "read_only",
        }
        for r in rows
    ]


async def delete_service_account(
    session: AsyncSession, actor: User, slug: str, sa_id: int
) -> dict:
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, actor.id), org)
    if not (member.is_owner or member.role in ("administrator", "maintainer")):
        raise OrganizationForbidden("requires owner, administrator, or maintainer role")
    sa_repo = ServiceAccountRepository(session)
    sa = await sa_repo.by_id(sa_id)
    if sa is None or sa.organization_id != org.id:
        raise OrganizationNotFound("service account not found")
    from app.identity.repositories import ApiTokenRepository, UserRepository

    membership = await org_repo.membership(org, sa.user_id)
    if membership is not None:
        await session.delete(membership)
    tokens = await ApiTokenRepository(session).for_user(sa.user_id)
    for token in tokens:
        if token.revoked_at is None:
            ApiTokenRepository(session).revoke(token)
    identity = await UserRepository(session).by_id(sa.user_id)
    if identity is not None:
        UserRepository(session).update_status(identity, "suspended")
    await session.delete(sa)
    await AuditRepository(session).record(
        actor_id=actor.id,
        action="organization.service_account.deleted",
        target_type="service_account",
        target_id=sa.id,
        organization_id=org.id,
        detail={"slug": slug, "name": sa.name},
    )
    return {"slug": slug, "name": sa.name}


AUDIT_ROLES = ("owner", "administrator", "maintainer")


async def get_org_audit_log(
    session: AsyncSession,
    user: User,
    slug: str,
    *,
    limit: int = 50,
    before_id: int | None = None,
    action: str | None = None,
) -> dict:
    from app.audit.repositories import AuditRepository

    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = _membership_or_raise(await org_repo.membership(org, user.id), org)
    if member.role not in AUDIT_ROLES:
        raise OrganizationForbidden("requires owner, administrator, or maintainer role for audit access")
    events = await AuditRepository(session).search(
        organization_id=org.id,
        limit=limit,
        before_id=before_id,
        action=action,
    )
    return {
        "items": events,
        "nextCursor": events[-1].id if len(events) == limit else None,
    }
