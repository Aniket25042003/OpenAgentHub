from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity.application import (
    resolve_cookie_active_user,
    resolve_cookie_reviewer_or_admin,
)
from app.publisher import application
from app.publisher.application import NamespaceForbidden, PublisherError
from app.ratelimit import RateLimitRule, enforce
from app.schemas import (
    NamespaceInfo,
    PackageSummary,
    PublisherActivity,
    PublisherOverview,
    ReviewQueueResponse,
    VersionIdentityDetail,
)

router = APIRouter(prefix="/api/v1")


def _write_limits(request: Request, user) -> None:
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )


@router.get("/me/overview", response_model=PublisherOverview)
async def overview(session: AsyncSession = Depends(get_session), user = Depends(resolve_cookie_active_user)):
    return await application.publisher_overview(session, user)


@router.get("/me/namespaces", response_model=list[NamespaceInfo])
async def namespaces(session: AsyncSession = Depends(get_session), user = Depends(resolve_cookie_active_user)):
    return await application.publisher_namespaces(session, user)


@router.get("/me/packages", response_model=list[PackageSummary])
async def packages(session: AsyncSession = Depends(get_session), user = Depends(resolve_cookie_active_user)):
    return await application.publisher_packages(session, user)


@router.get("/me/packages/{namespace}/{name}/versions/{version}", response_model=VersionIdentityDetail)
async def version_identity(
    namespace: str,
    name: str,
    version: str,
    session: AsyncSession = Depends(get_session),
    user = Depends(resolve_cookie_active_user),
):
    try:
        return await application.publisher_version_identity(session, user, namespace, name, version)
    except NamespaceForbidden as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except PublisherError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/me/activity", response_model=PublisherActivity)
async def activity(session: AsyncSession = Depends(get_session), user = Depends(resolve_cookie_active_user)):
    items = await application.publisher_activity(session, user)
    return PublisherActivity(items=items)


@router.get("/admin/review-queue", response_model=ReviewQueueResponse)
async def review_queue(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(resolve_cookie_reviewer_or_admin),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))
    items = await application.admin_review_queue(session, user)
    return ReviewQueueResponse(items=items)
