from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity.application import get_current_user
from app.registry import application
from app.registry.application import (
    AgentNotFound,
    ArchiveMissing,
    ArchiveTooLarge,
    InvalidPayload,
    InvalidSignatureFile,
    RegistryError,
    VersionConflict,
    VersionNotFound,
)
from app.schemas import AgentSummary, AgentVersionDetail, SearchResponse, VersionsResponse

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
    except ArchiveMissing as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await session.commit()
    return Response(content=data, media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff"})


@router.put("/agents/{namespace}/{name}/versions/{version}")
async def publish_version(
    namespace: str,
    name: str,
    version: str,
    archive: UploadFile,
    signature: UploadFile,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
):
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
    except RegistryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "security": result.security, "findings": result.findings}


@router.post("/agents/{namespace}/{name}/versions/{version}/scan")
async def trigger_scan(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    try:
        scan_status, findings = await application.trigger_rescan(session, namespace, name, version)
    except VersionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await session.commit()
    return {"status": scan_status, "findings": findings}
