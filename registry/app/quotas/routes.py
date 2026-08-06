from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity.application import resolve_cookie_active_user
from app.organizations.application import (
    OrganizationError,
    OrganizationForbidden,
    OrganizationNotFound,
)
from app.organizations.repositories import OrganizationRepository
from app.quotas import application
from app.quotas.application import QuotaError
from app.ratelimit import RateLimitRule, enforce
from app.schemas import OrgQuotaResponse, OrgQuotaUpdateRequest

router = APIRouter(prefix="/api/v1")

MANAGE_ROLES = ("owner", "administrator")


def _map_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, OrganizationNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, OrganizationForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, (OrganizationError, QuotaError)):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    raise exc


@router.get("/orgs/{slug}/quota", response_model=OrgQuotaResponse)
async def get_org_quota(
    slug: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org_repo = OrganizationRepository(session)
        org = await org_repo.by_slug(slug)
        if org is None:
            raise OrganizationNotFound(f"organization '{slug}' not found")
        member = await org_repo.membership(org, user.id)
        if member is None:
            raise OrganizationForbidden("not a member of this organization")
        return await application.get_org_quota_snapshot(session, org.id)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.put("/orgs/{slug}/quota", response_model=OrgQuotaResponse)
async def update_org_quota(
    slug: str,
    req: OrgQuotaUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org_repo = OrganizationRepository(session)
        org = await org_repo.by_slug(slug)
        if org is None:
            raise OrganizationNotFound(f"organization '{slug}' not found")
        member = await org_repo.membership(org, user.id)
        if member is None:
            raise OrganizationForbidden("not a member of this organization")
        if member.role not in MANAGE_ROLES:
            raise OrganizationForbidden(
                "requires owner or administrator role for quota overrides"
            )
        result = await application.set_org_quota_overrides(
            session,
            org,
            user,
            limits=req.limits,
            ttl_days=req.ttlDays,
        )
        await session.commit()
        snapshot = await application.get_org_quota_snapshot(session, org.id)
        snapshot["overridesExpireAt"] = result["overridesExpireAt"]
        return snapshot
    except (OrganizationError, QuotaError) as exc:
        raise _map_errors(exc) from exc