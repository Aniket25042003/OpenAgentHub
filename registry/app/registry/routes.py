import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.ratelimit import RateLimitRule, enforce
from app.entitlements.application import QuotaExceeded, check_publish_rate
from app.quotas.application import QuotaExceeded as WebQuotaExceeded
from app.identity.application import (
    require_active_user,
    require_scope,
    resolve_cookie_reviewer_or_admin,
    resolve_optional_user,
)
from app.registry import application
from app.registry.catalog import CatalogQueryError, load_catalog_page
from app.registry.cache import get_catalog_cache
from app.registry.downloads import get_download_buffer
from app.registry.repositories import CatalogRepository
from app.registry.application import (
    AgentNotFound,
    ArchiveMissing,
    ArchiveTooLarge,
    InvalidPayload,
    InvalidSignatureFile,
    MaintainerNotFound,
    NamespaceConflict,
    NamespaceForbidden,
    NamespaceNotFound,
    NamespaceReserved,
    RegistryError,
    ScanInProgress,
    SigningKeyForbidden,
    VersionBlocked,
    VersionConflict,
    VersionNotFound,
)
from app.schemas import (
    AgentSummary,
    AgentVersionDetail,
    AuditEntry,
    AuditLogResponse,
    CatalogResponse,
    GrantRequest,
    GrantResponse,
    MaintainerAddRequest,
    NamespaceClaimRequest,
    ReviewRequest,
    RevocationFeedResponse,
    SearchResponse,
    VersionsResponse,
    VisibilityUpdateRequest,
    YankRequest,
)

router = APIRouter(prefix="/api/v1")


async def _enforce_download_bytes(request: Request, session, org_id: int, length: int) -> None:
    from app.quotas.application import QuotaExceeded as QuotaBlocked
    from app.quotas import application as quota_app

    try:
        await quota_app.enforce_download_quota(session, org_id, bytes_to_serve=length)
    except QuotaBlocked as exc:
        reset = quota_app.next_period_start()
        retry = f"bandwidth quota resets {reset}"
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"{exc}; {retry}",
            headers={"Retry-After": "86400", "X-Quota-Reset": reset},
        ) from exc


def _write_limits(request: Request, user) -> None:
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )


@router.get("/catalog", response_model=CatalogResponse, response_model_exclude_none=True)
async def catalog(
    request: Request,
    q: str | None = None,
    framework: str | None = None,
    models: str | None = None,
    tags: str | None = None,
    review_status: str | None = None,
    security_status: str | None = None,
    permission: str | None = None,
    runtime: str | None = None,
    publisher_status: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))

    params = {
        "q": q,
        "framework": framework,
        "models": models,
        "tags": tags,
        "review_status": review_status,
        "security_status": security_status,
        "permission": permission,
        "runtime": runtime,
        "publisher_status": publisher_status,
        "cursor": cursor,
        "limit": limit,
    }
    cache = get_catalog_cache()
    key = cache.cache_key(params)
    try:
        watermark = await CatalogRepository(session).watermark()
        entry = cache.get(key, watermark)
        if entry is None:
            page = await load_catalog_page(
                session,
                q=q,
                framework=framework,
                models=models,
                tags=tags,
                review_status=review_status,
                security_status=security_status,
                permission=permission,
                runtime=runtime,
                publisher_status=publisher_status,
                cursor_raw=cursor,
                limit=limit,
            )
            payload = CatalogResponse(
                schemaVersion=1,
                watermark=watermark,
                items=[i.model_dump(mode="json") for i in page.items],
                nextCursor=page.next_cursor,
            ).model_dump(mode="json")
            entry = cache.put(key, watermark, payload)
    except CatalogQueryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:  # noqa: BLE001
        stale = cache.stale(key)
        if stale is not None:
            return Response(
                content=json.dumps(stale.payload),
                media_type="application/json",
                headers={
                    "ETag": stale.etag,
                    "Cache-Control": f"public, max-age={settings.catalog_cache_ttl_seconds}",
                    "X-Catalog-Stale": "true",
                    "Age": str(int(time.time() - stale.cached_at)),
                },
            )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="catalog temporarily unavailable") from None

    headers = {
        "ETag": entry.etag,
        "Cache-Control": f"public, max-age={settings.catalog_cache_ttl_seconds}",
    }
    if request.headers.get("if-none-match") == entry.etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=json.dumps(entry.payload), media_type="application/json", headers=headers)


@router.get("/agents", response_model=SearchResponse)
async def search_agents(
    request: Request,
    q: str | None = None,
    framework: str | None = None,
    tags: str | None = None,
    models: str | None = None,
    sort: str = "downloads",
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))
    items = await application.search_agents(
        session,
        q=q,
        framework=framework,
        tags=tags,
        models=models,
        sort=sort,
        limit=limit,
        offset=offset,
        user=user,
    )
    return SearchResponse(items=items)


@router.get("/agents/{namespace}/{name}", response_model=AgentSummary)
async def get_agent(
    namespace: str,
    name: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))
    try:
        return await application.get_agent_summary(session, namespace, name, user)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/agents/{namespace}/{name}/versions", response_model=VersionsResponse)
async def list_versions(
    namespace: str,
    name: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))
    try:
        versions = await application.list_versions(session, namespace, name, user)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return VersionsResponse(versions=versions)


@router.get("/agents/{namespace}/{name}/versions/{version}", response_model=AgentVersionDetail)
async def get_version(
    namespace: str,
    name: str,
    version: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.anonymous_reads_per_minute, 60))
    try:
        return await application.get_version_detail(session, namespace, name, version, user)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/agents/{namespace}/{name}/versions/{version}/archive")
async def download_archive(
    namespace: str,
    name: str,
    version: str,
    request: Request,
    dl: str | None = None,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.downloads_per_minute_by_ip, 60), bucket="dl")
    try:
        if dl is not None:
            data, version_id, org_id = await application.download_archive_via_token(
                session, namespace, name, version, dl
            )
        else:
            data, version_id, org_id = await application.download_archive(
                session, namespace, name, version, user
            )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionBlocked as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ArchiveMissing as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if org_id is not None:
        await _enforce_download_bytes(request, session, org_id, len(data))
    get_download_buffer().record(version_id, organization_id=org_id, bytes=len(data))
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Accept-Ranges": "bytes",
        },
    )


@router.post("/agents/{namespace}/{name}/versions/{version}/download-url")
async def issue_download_url(
    namespace: str,
    name: str,
    version: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(require_active_user),
):
    settings = get_settings()
    enforce(request, ip_rule=RateLimitRule(settings.downloads_per_minute_by_ip, 60), bucket="dl")
    try:
        result = await application.issue_download_url(session, namespace, name, version, user, str(request.base_url))
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionBlocked as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except application.DownloadUrlError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    await session.commit()
    return result


@router.get("/revocations", response_model=RevocationFeedResponse)
async def revocation_feed(session: AsyncSession = Depends(get_session)):
    items = await application.get_revocation_feed(session)
    return RevocationFeedResponse(items=items)


@router.put("/agents/{namespace}/{name}/versions/{version}")
async def publish_version(
    namespace: str,
    name: str,
    version: str,
    archive: UploadFile,
    signature: UploadFile,
    request: Request,
    visibility: str = "public",
    session: AsyncSession = Depends(get_session),
    user = Depends(require_scope("packages:publish")),
):
    _write_limits(request, user)
    try:
        check_publish_rate(request.client.host if request.client else "unknown")
    except QuotaExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    archive_data = await archive.read(get_settings().max_archive_bytes + 1)
    signature_raw = await signature.read(1024 * 1024 + 1)
    try:
        result = await application.publish_version(
            session,
            user,
            namespace=namespace,
            name=name,
            version=version,
            archive_data=archive_data,
            signature_raw=signature_raw,
            visibility=visibility,
        )
    except ArchiveTooLarge as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)) from exc
    except InvalidSignatureFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except InvalidPayload as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except VersionConflict as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except (SigningKeyForbidden, NamespaceForbidden, NamespaceReserved) as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WebQuotaExceeded as exc:
        from app.quotas.application import next_period_start

        reset = next_period_start()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={
                "Retry-After": "86400",
                "X-Quota-Reset": reset,
                "X-Quota-Dimension": exc.dimension,
            },
        ) from exc
    except QuotaExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "security": result.security, "findings": result.findings}


@router.post("/agents/{namespace}/{name}/versions/{version}/scan")
async def trigger_scan(
    namespace: str,
    name: str,
    version: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    _write_limits(request, user)
    try:
        scan_status, findings = await application.trigger_rescan(session, user, namespace, name, version)
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ScanInProgress as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc), headers={"Retry-After": "10"}
        ) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    await session.commit()
    return {"status": scan_status, "findings": findings}


@router.post("/admin/agents/{namespace}/{name}/versions/{version}/review")
async def review_version(
    namespace: str,
    name: str,
    version: str,
    req: ReviewRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(resolve_cookie_reviewer_or_admin),
):
    _write_limits(request, user)
    try:
        result = await application.review_version(
            session, user, namespace=namespace, name=name, version=version, action=req.action, reason=req.reason, notes=req.notes
        )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, **result}


@router.post("/namespaces")
async def claim_namespace(
    req: NamespaceClaimRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    _write_limits(request, user)
    try:
        ns = await application.claim_namespace(session, user, req.name)
    except (NamespaceConflict, NamespaceReserved, RegistryError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if isinstance(exc, NamespaceConflict) else (
                status.HTTP_403_FORBIDDEN if isinstance(exc, NamespaceReserved) else status.HTTP_400_BAD_REQUEST
            ),
            detail=str(exc),
        ) from exc
    await session.commit()
    return {"ok": True, "namespace": ns.name}


@router.post("/namespaces/{namespace}/maintainers")
async def add_maintainer(
    namespace: str,
    req: MaintainerAddRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    _write_limits(request, user)
    try:
        result = await application.add_namespace_maintainer(session, user, namespace, req.username, req.role)
    except (NamespaceNotFound, MaintainerNotFound) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (NamespaceForbidden, RegistryError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN if isinstance(exc, NamespaceForbidden) else status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except NamespaceConflict as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await session.commit()
    return result


@router.post("/admin/agents/{namespace}/{name}/versions/{version}/yank")
async def yank_version(
    namespace: str,
    name: str,
    version: str,
    req: YankRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    _write_limits(request, user)
    try:
        changed = await application.yank_version(session, user, namespace, name, version, req.yanked)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "yanked": req.yanked, "changed": changed}


@router.patch("/agents/{namespace}/{name}/visibility")
async def update_visibility(
    namespace: str,
    name: str,
    req: VisibilityUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_scope("packages:manage")),
):
    _write_limits(request, user)
    try:
        result = await application.set_package_visibility(
            session, user, namespace, name, req.visibility, req.organizationSlug
        )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, **result}


@router.get("/agents/{namespace}/{name}/grants")
async def list_grants(
    namespace: str,
    name: str,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    try:
        return await application.list_package_grants(session, user, namespace, name)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/agents/{namespace}/{name}/grants", response_model=GrantResponse)
async def grant_access(
    namespace: str,
    name: str,
    req: GrantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_scope("packages:manage")),
):
    _write_limits(request, user)
    try:
        result = await application.grant_package_access(
            session, user, namespace, name, username=req.username, team_id=req.teamId
        )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return GrantResponse(**result)


@router.delete("/agents/{namespace}/{name}/grants", response_model=GrantResponse)
async def revoke_access(
    namespace: str,
    name: str,
    req: GrantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_scope("packages:manage")),
):
    _write_limits(request, user)
    try:
        result = await application.revoke_package_access(
            session, user, namespace, name, username=req.username, team_id=req.teamId
        )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return GrantResponse(**result)


@router.get("/agents/{namespace}/{name}/audit-log", response_model=AuditLogResponse)
async def package_audit_log(
    namespace: str,
    name: str,
    limit: int = 50,
    before_id: int | None = None,
    action: str | None = None,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_optional_user),
):
    try:
        result = await application.get_package_audit_log(
            session, user, namespace, name, limit=min(limit, 200), before_id=before_id, action=action
        )
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AuditLogResponse(
        items=[AuditEntry.from_event(e) for e in result["items"]],
        nextCursor=result["nextCursor"],
    )
