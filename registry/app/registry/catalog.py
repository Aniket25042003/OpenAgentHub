"""Versioned public catalog with bounded SQL pagination and a small cache.

The catalog resolves the latest *visible* version of each agent inside the
database (window function over ``sort_key``) instead of loading every historical
version into Python. Responses carry an ``ETag`` derived from the watermark plus
payload, a short ``Cache-Control``, and last-known-good payloads labelled as
stale when the database is unavailable.
"""

import base64
import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.registry.models import BLOCKED_REVIEW_STATUSES, Agent, AgentVersion
from app.schemas import CatalogItem
PAGE_SIZE = 100
PYTHON_FILTER_PAGE_GUARD = 20


class CatalogQueryError(ValueError):
    pass


def _dt(value) -> str | None:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.isoformat() + "Z"
    return value.isoformat().replace("+00:00", "Z")


def _manifest_fields(manifest: dict) -> dict:
    runtime_raw = manifest.get("runtime")
    runtime = runtime_raw.get("language") if isinstance(runtime_raw, dict) else runtime_raw
    interfaces: list[str] = []
    iface_obj = manifest.get("interfaces")
    if isinstance(iface_obj, dict):
        for kind, value in iface_obj.items():
            if not isinstance(value, dict):
                continue
            ref = value.get("command") or value.get("entrypoint") or value.get("endpoint")
            interfaces.append(f"{kind}:{ref}" if ref else kind)
    return {
        "runtime": runtime,
        "interfaces": sorted(interfaces),
        "permissions": list(manifest.get("permissions") or []),
        "secrets": list(manifest.get("secrets") or []),
    }


def _to_catalog_item(agent: Agent, ver: AgentVersion, signer_verified: bool) -> CatalogItem:
    extra = _manifest_fields(ver.manifest)
    return CatalogItem(
        namespace=agent.namespace,
        name=agent.name,
        version=ver.version,
        digest=ver.sha256,
        author=agent.author,
        description=agent.description,
        license=agent.license,
        framework=agent.framework,
        models=agent.models,
        tags=agent.tags,
        runtime=extra["runtime"],
        interfaces=extra["interfaces"],
        permissions=extra["permissions"],
        secrets=extra["secrets"],
        downloads=ver.download_count,
        publisher=agent.author,
        signerVerified=signer_verified,
        reviewStatus=ver.review_status,
        securityStatus=ver.security_status,
        yanked=ver.yanked,
        publishedAt=_dt(ver.published_at) or "",
        reviewedAt=_dt(ver.reviewed_at),
    )


def _matches(
    item: CatalogItem,
    *,
    permission: str | None,
    runtime: str | None,
    publisher_status: str | None,
) -> bool:
    if permission:
        want_none = permission == "none"
        if (want_none and item.permissions) or (not want_none and permission not in item.permissions):
            return False
    if runtime and item.runtime != runtime:
        return False
    if publisher_status == "verified" and not item.signerVerified:
        return False
    if publisher_status == "unverified" and item.signerVerified:
        return False
    return True


def _encode_cursor(sk: str, version_id: int) -> str:
    payload = json.dumps({"s": sk, "i": version_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str | None) -> tuple[str, int] | None:
    if not cursor:
        return None
    try:
        obj = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return str(obj["s"]), int(obj["i"])
    except Exception:  # noqa: BLE001
        return None


def _ranked_visible():
    rank = func.row_number().over(
        partition_by=AgentVersion.agent_id,
        order_by=(AgentVersion.sort_key.desc(), AgentVersion.published_at.desc(), AgentVersion.id.desc()),
    ).label("rn")
    sub = (
        select(AgentVersion, rank)
        .where(~AgentVersion.yanked & ~AgentVersion.review_status.in_(BLOCKED_REVIEW_STATUSES))
        .subquery()
    )
    latest = aliased(AgentVersion, sub)
    return latest, sub, sub.c.rn == 1


@dataclass(frozen=True)
class CatalogPage:
    items: list[CatalogItem]
    next_cursor: str | None


async def load_catalog_page(
    session: AsyncSession,
    *,
    q: str | None,
    framework: str | None,
    models: str | None,
    tags: str | None,
    review_status: str | None,
    security_status: str | None,
    permission: str | None,
    runtime: str | None,
    publisher_status: str | None,
    cursor_raw: str | None,
    limit: int,
) -> CatalogPage:
    limit = max(1, min(limit, PAGE_SIZE))
    cursor = _decode_cursor(cursor_raw)
    if cursor_raw is not None and cursor is None:
        raise CatalogQueryError("invalid cursor")

    latest, sub, top_rank = _ranked_visible()
    stmt = select(Agent, latest).where(Agent.id == latest.agent_id, top_rank)

    conditions = [Agent.visibility == "public"]
    if q:
        like = f"%{q.lower()}%"
        conditions.append(
            func.lower(Agent.name).like(like)
            | func.lower(Agent.namespace).like(like)
            | func.lower(Agent.description).like(like)
        )
    if framework:
        conditions.append(Agent.framework == framework)
    if models:
        wanted = [m.strip().lower() for m in models.split(",") if m.strip()]
        conditions.append(Agent.models.contains(wanted))
    if tags:
        wanted = [t.strip().lower() for t in tags.split(",") if t.strip()]
        conditions.append(Agent.tags.contains(wanted))
    if review_status:
        conditions.append(latest.review_status == review_status)
    if security_status:
        conditions.append(latest.security_status == security_status)
    if cursor:
        conditions.append((latest.sort_key < cursor[0]) | ((latest.sort_key == cursor[0]) & (latest.id < cursor[1])))
    if conditions:
        stmt = stmt.where(*conditions)

    rows_cap = limit * PYTHON_FILTER_PAGE_GUARD
    rows = (
        (await session.execute(stmt.order_by(latest.sort_key.desc(), latest.id.desc()).limit(rows_cap)))
        .all()
    )

    fingerprints = {ver.signature.get("publicKeyId") for _, ver in rows if ver.signature.get("publicKeyId")}
    verified: set[str] = set()
    if fingerprints:
        from app.identity.models import SigningKey

        keys = (
            await session.execute(select(SigningKey).where(SigningKey.fingerprint.in_(fingerprints)))
        ).scalars().all()
        verified = {k.fingerprint for k in keys if k.revoked_at is None}

    items: list[CatalogItem] = []
    last_sk: str | None = None
    last_id: int | None = None
    stopped_at: int | None = None
    for idx, (agent, ver) in enumerate(rows):
        fp = ver.signature.get("publicKeyId")
        item = _to_catalog_item(agent, ver, bool(fp) and fp in verified)
        if not _matches(item, permission=permission, runtime=runtime, publisher_status=publisher_status):
            continue
        items.append(item)
        last_sk = ver.sort_key
        last_id = ver.id
        if len(items) >= limit:
            stopped_at = idx
            break

    more_beyond_window = len(rows) >= rows_cap
    more_in_window = stopped_at is not None and stopped_at + 1 < len(rows)
    next_cursor = (
        _encode_cursor(last_sk, last_id)
        if last_id is not None and (more_beyond_window or more_in_window)
        else None
    )
    return CatalogPage(items=items, next_cursor=next_cursor)


def etag_for(payload: dict) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]
    return f'"{digest}"'