from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity.application import resolve_cookie_active_user
from app.organizations import application
from app.organizations.application import (
    OrganizationError,
)
from app.ratelimit import RateLimitRule, enforce
from app.schemas import (
    AcceptInviteRequest,
    AuditEntry,
    AuditLogResponse,
    InviteRequest,
    InviteResponse,
    OrgActionResponse,
    OrgCreateRequest,
    OrgInfo,
    OrgInvitationsResponse,
    OrgMemberItem,
    OrgMemberRequest,
    OrgMembersResponse,
    OrgRoleRequest,
    OrgTeamsResponse,
    OrgUpdateRequest,
    OrganizationDetail,
    ServiceAccountCreateRequest,
    ServiceAccountItem,
    ServiceAccountsResponse,
    TeamCreateRequest,
    TeamMemberRequest,
)

router = APIRouter(prefix="/api/v1")


def _org_limits(request: Request, user) -> None:
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )


def _map_errors(exc: OrganizationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/orgs", response_model=list[OrgInfo])
async def list_orgs(
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    return await application.list_my_organizations(session, user)


@router.post("/orgs", response_model=OrgInfo, status_code=status.HTTP_201_CREATED)
async def create_org(
    payload: OrgCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        org = await application.create_organization(
            session, user, payload.slug, payload.displayName
        )
        await session.commit()
        return {
            "slug": org.slug,
            "displayName": org.display_name,
            "status": org.status,
            "role": "owner",
        }
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.patch("/orgs/{slug}", response_model=None)
async def update_org(
    slug: str,
    payload: OrgUpdateRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
) -> None:
    try:
        await application.update_organization(
            session, user, slug, display_name=payload.displayName
        )
        await session.commit()
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}", response_model=OrganizationDetail)
async def get_org(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        return await application.get_organization(session, user, slug)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/members", response_model=OrgMembersResponse)
async def get_members(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        items = await application.list_members(session, user, slug)
        return OrgMembersResponse(items=[OrgMemberItem(**item) for item in items])
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post(
    "/orgs/{slug}/members",
    response_model=OrgMemberItem,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    slug: str,
    payload: OrgMemberRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        result = await application.add_member(
            session, user, slug, payload.username, payload.role
        )
        await session.commit()
        return result
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.patch("/orgs/{slug}/members/{username}")
async def change_member_role(
    slug: str,
    username: str,
    payload: OrgRoleRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.change_member_role(
            session, user, slug, username, payload.role
        )
        await session.commit()
        return result
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.delete("/orgs/{slug}/members/{username}")
async def remove_member(
    slug: str,
    username: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.remove_member(session, user, slug, username)
        await session.commit()
        return result
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.delete("/orgs/{slug}/leave")
async def leave_org(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.leave_organization(session, user, slug)
        await session.commit()
        return result
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/invitations", response_model=OrgInvitationsResponse)
async def list_invitations(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        items = await application.list_invitations(session, user, slug)
        return OrgInvitationsResponse(items=items)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post(
    "/orgs/{slug}/invitations",
    response_model=InviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    slug: str,
    payload: InviteRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        result = await application.invite_member(
            session, user, slug, payload.username, payload.role
        )
        await session.commit()
        return InviteResponse(**result)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post("/orgs/invitations/accept", response_model=OrgActionResponse)
async def accept_invite(
    payload: AcceptInviteRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.accept_invitation(session, user, payload.token)
        await session.commit()
        return OrgActionResponse(**result)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/teams", response_model=OrgTeamsResponse)
async def list_teams(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        items = await application.list_teams(session, user, slug)
        return OrgTeamsResponse(items=items)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post(
    "/orgs/{slug}/teams", response_model=dict, status_code=status.HTTP_201_CREATED
)
async def create_team(
    slug: str,
    payload: TeamCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        result = await application.create_team(session, user, slug, payload.name)
        await session.commit()
        return result
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post("/orgs/{slug}/teams/{team_id}/members", response_model=OrgActionResponse)
async def add_team_member(
    slug: str,
    team_id: int,
    payload: TeamMemberRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        result = await application.add_team_member(
            session, user, slug, team_id, payload.username
        )
        await session.commit()
        return OrgActionResponse(**result)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.delete(
    "/orgs/{slug}/teams/{team_id}/members/{username}", response_model=OrgActionResponse
)
async def remove_team_member(
    slug: str,
    team_id: int,
    username: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.remove_team_member(
            session, user, slug, team_id, username
        )
        await session.commit()
        return OrgActionResponse(**result)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/service-accounts", response_model=ServiceAccountsResponse)
async def list_service_accounts(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        items = await application.list_service_accounts(session, user, slug)
        return ServiceAccountsResponse(items=[ServiceAccountItem(**i) for i in items])
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post(
    "/orgs/{slug}/service-accounts",
    response_model=ServiceAccountItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_service_account(
    slug: str,
    payload: ServiceAccountCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    _org_limits(request, user)
    try:
        result = await application.create_service_account(
            session, user, slug, name=payload.name, role=payload.role
        )
        await session.commit()
        return ServiceAccountItem(
            id=result["id"],
            name=result["name"],
            username=f"svc-{slug}-{result['name'].strip().lower().replace(' ', '-')}",
            role=result["role"],
            status="active",
        )
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.delete("/orgs/{slug}/service-accounts/{sa_id}", response_model=OrgActionResponse)
async def delete_service_account(
    slug: str,
    sa_id: int,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.delete_service_account(session, user, slug, sa_id)
        await session.commit()
        return OrgActionResponse(**result)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/audit-log", response_model=AuditLogResponse)
async def org_audit_log(
    slug: str,
    limit: int = 50,
    before_id: int | None = None,
    action: str | None = None,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    try:
        result = await application.get_org_audit_log(
            session, user, slug, limit=min(limit, 200), before_id=before_id, action=action
        )
    except OrganizationError as exc:
        raise _map_errors(exc) from exc
    return AuditLogResponse(
        items=[AuditEntry.from_event(e) for e in result["items"]],
        nextCursor=result["nextCursor"],
    )
