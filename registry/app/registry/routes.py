from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.entitlements.application import QuotaExceeded, check_publish_rate
from app.identity.application import require_active_user, require_reviewer_or_admin
from app.registry import application
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
    MaintainerAddRequest,
    NamespaceClaimRequest,
    ReviewRequest,
    RevocationFeedResponse,
    SearchResponse,
    VersionsResponse,
    YankRequest,
)

router = APIRouter(prefix="/api/v1")


@router.get("/agents", response_model=SearchResponse)
async def search_agents(
    q: str | None = None,
    framework: str | None = None,
    tags: str | None = None,
    models: str | None = None,
    sort: str = "downloads",
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    items = await application.search_agents(
        session, q=q, framework=framework, tags=tags, models=models, sort=sort, limit=limit, offset=offset
    )
    return SearchResponse(items=items)


@router.get("/agents/{namespace}/{name}", response_model=AgentSummary)
async def get_agent(namespace: str, name: str, session: AsyncSession = Depends(get_session)):
    try:
        return await application.get_agent_summary(session, namespace, name)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/agents/{namespace}/{name}/versions", response_model=VersionsResponse)
async def list_versions(namespace: str, name: str, session: AsyncSession = Depends(get_session)):
    try:
        versions = await application.list_versions(session, namespace, name)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return VersionsResponse(versions=versions)


@router.get("/agents/{namespace}/{name}/versions/{version}", response_model=AgentVersionDetail)
async def get_version(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    try:
        return await application.get_version_detail(session, namespace, name, version)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/agents/{namespace}/{name}/versions/{version}/archive")
async def download_archive(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    try:
        data = await application.download_archive(session, namespace, name, version)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionBlocked as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ArchiveMissing as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await session.commit()
    return Response(content=data, media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff"})


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
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
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
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
    try:
        scan_status, findings = await application.trigger_rescan(session, namespace, name, version)
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ScanInProgress as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc), headers={"Retry-After": "10"}
        ) from exc
    await session.commit()
    return {"status": scan_status, "findings": findings}


@router.post("/admin/agents/{namespace}/{name}/versions/{version}/review")
async def review_version(
    namespace: str,
    name: str,
    version: str,
    req: ReviewRequest,
    session: AsyncSession = Depends(get_session),
    user = Depends(require_reviewer_or_admin),
):
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
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
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
    session: AsyncSession = Depends(get_session),
    user = Depends(require_active_user),
):
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
    session: AsyncSession = Depends(get_session),
    user = Depends(require_reviewer_or_admin),
):
    try:
        changed = await application.yank_version(session, user, namespace, name, version, req.yanked)
    except AgentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "yanked": req.yanked, "changed": changed}
