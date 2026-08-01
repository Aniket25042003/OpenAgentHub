from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Agent, AgentVersion, User
from app.schemas import (
    AgentVersionDetail,
    AgentSummary,
    SearchResponse,
    SecurityReport,
    SignatureFile,
    VersionsResponse,
    dt_iso,
)
from app.security import check_archive_safety, sha256_hex
from app.store import ArchiveStore, ArchiveStoreError
from app.config import get_settings

router = APIRouter(prefix="/api/v1")

TRUST_DEFAULT = "unknown"


def _summary(agent, version, downloads) -> AgentSummary:
    return AgentSummary(
        namespace=agent.namespace,
        name=agent.name,
        version=version.version,
        author=agent.author,
        description=agent.description,
        license=agent.license,
        framework=agent.framework,
        models=agent.models,
        tags=agent.tags,
        downloads=downloads,
        trust=TRUST_DEFAULT if version is None else ("untrusted" if version.security_status == "flagged" else "unknown"),
    )


def _detail(version, agent) -> AgentVersionDetail:
    return AgentVersionDetail(
        name=f"{agent.namespace}/{agent.name}",
        version=version.version,
        author=agent.author,
        description=agent.description,
        manifest=version.manifest,
        publishedAt=dt_iso(version.published_at),
        downloadCount=version.download_count,
        trust="untrusted" if version.security_status == "flagged" else TRUST_DEFAULT,
        signature=SignatureFile(**version.signature),
        security=SecurityReport(status=version.security_status, findings=version.security_findings),
    )


async def _resolve_version(session: AsyncSession, agent: Agent, version: str) -> AgentVersion | None:
    if version == "latest":
        return (
            await session.execute(
                select(AgentVersion).where(AgentVersion.agent_id == agent.id).order_by(AgentVersion.published_at.desc())
            )
        ).scalars().first()
    return (
        await session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id, AgentVersion.version == version))
    ).scalar_one_or_none()


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
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    versions = await session.execute(
        select(AgentVersion)
        .order_by(AgentVersion.published_at.desc())
    )
    latest_by_agent: dict[int, AgentVersion] = {}
    for v in versions.scalars():
        latest_by_agent.setdefault(v.agent_id, v)

    stmt = select(Agent)
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

    agents = (await session.execute(stmt)).scalars().all()
    items: list[AgentSummary] = []
    for agent in agents:
        ver = latest_by_agent.get(agent.id)
        if ver is None:
            continue
        items.append(_summary(agent, ver, ver.download_count))

    if sort == "newest":
        items.sort(key=lambda s: s.version, reverse=True)
    elif sort == "trending":
        items.sort(key=lambda s: (s.downloads, s.version), reverse=True)
    else:
        items.sort(key=lambda s: s.downloads, reverse=True)

    return SearchResponse(items=items[offset : offset + limit])


@router.get("/agents/{namespace}/{name}", response_model=AgentSummary)
async def get_agent(namespace: str, name: str, session: AsyncSession = Depends(get_session)):
    agent = (await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    ver = (await session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id).order_by(AgentVersion.published_at.desc()))).scalars().first()
    if ver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent has no published versions")
    return _summary(agent, ver, ver.download_count)


@router.get("/agents/{namespace}/{name}/versions", response_model=VersionsResponse)
async def list_versions(namespace: str, name: str, session: AsyncSession = Depends(get_session)):
    agent = (await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    vers = (await session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id).order_by(AgentVersion.published_at.desc()))).scalars().all()
    return VersionsResponse(versions=[v.version for v in vers])


@router.get("/agents/{namespace}/{name}/versions/{version}", response_model=AgentVersionDetail)
async def get_version(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    agent = (await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    return _detail(ver, agent)


@router.get("/agents/{namespace}/{name}/versions/{version}/archive")
async def download_archive(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    from fastapi.responses import Response

    agent = (await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    data = await ArchiveStore().get(namespace, name, ver.version)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="archive missing on server")
    ver.download_count += 1
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
    user: User = Depends(get_current_user),
):
    from app.security import SignatureError, check_archive_safety, manifest_from_archive, verify_signature

    settings = get_settings()
    archive_data = await archive.read(settings.max_archive_bytes + 1)
    if len(archive_data) > settings.max_archive_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="archive too large")
    signature_raw = await signature.read(1024 * 1024 + 1)
    if len(signature_raw) > 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="signature file too large")
    import json

    try:
        sig = SignatureFile(**json.loads(signature_raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid signature file: {exc}") from exc

    try:
        verify_signature(sig, archive_data)
    except SignatureError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    manifest_name = sig.name
    if manifest_name != f"{namespace}/{name}":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="signature name does not match route")
    if sig.version != version:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="signature version does not match route")

    findings = check_archive_safety(archive_data, max_bytes=settings.max_archive_bytes)
    security_status = "flagged" if findings else "clean"

    manifest = manifest_from_archive(archive_data)
    if manifest.get("name") != manifest_name or manifest.get("version") != version:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="manifest does not match signature")

    framework_raw = manifest.get("framework")
    framework = framework_raw.get("name") if isinstance(framework_raw, dict) else framework_raw

    agent = (
        await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))
    ).scalar_one_or_none()
    if agent is None:
        agent = Agent(
            namespace=namespace,
            name=name,
            owner_id=user.id,
            author=manifest.get("author", user.username),
            description=manifest.get("description", ""),
            license=manifest.get("license", ""),
            framework=framework,
            models=list(manifest.get("models", {}).get("supported", [])),
            tags=list(manifest.get("tags", [])),
        )
        session.add(agent)
        await session.flush()
    else:
        agent.author = manifest.get("author", agent.author)
        agent.description = manifest.get("description", agent.description)
        agent.license = manifest.get("license", agent.license)
        agent.framework = framework
        agent.models = list(manifest.get("models", {}).get("supported", []))
        agent.tags = list(manifest.get("tags", []))
        agent.updated_at = datetime.now()

    existing = (
        await session.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id, AgentVersion.version == version))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"version {version} already published (re-publish with a new version)")

    ver = AgentVersion(
        agent_id=agent.id,
        version=version,
        manifest=manifest,
        sha256=sha256_hex(archive_data),
        archive_name=f"{namespace}_{name}-{version}.ahb",
        signature=sig.model_dump(),
        published_by_id=user.id,
        security_status=security_status,
        security_findings=findings,
    )
    session.add(ver)
    try:
        await ArchiveStore().put(namespace, name, version, archive_data)
    except ArchiveStoreError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "security": security_status, "findings": findings}


@router.post("/agents/{namespace}/{name}/versions/{version}/scan")
async def trigger_scan(namespace: str, name: str, version: str, session: AsyncSession = Depends(get_session)):
    agent = (await session.execute(select(Agent).where(Agent.namespace == namespace, Agent.name == name))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    ver = await _resolve_version(session, agent, version)
    if ver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    archive = await ArchiveStore().get(namespace, name, ver.version)
    if archive is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="archive missing on server")
    findings = check_archive_safety(archive, max_bytes=get_settings().max_archive_bytes)
    ver.security_status = "flagged" if findings else "clean"
    ver.security_findings = findings
    await session.commit()
    return {"status": ver.security_status, "findings": findings}
