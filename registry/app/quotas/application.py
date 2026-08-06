"""M-8.9 Storage, download, and member quotas.

Quota dimensions are tracked per organization; limits come from registry
defaults (``config.py``) optionally overridden per org (``OrgQuota``) with an
expiry and an audit record. Usage is computed from the registry tables on
demand rather than maintained as a running counter, so it cannot drift.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import User
from app.organizations.models import Organization, OrganizationMember, ServiceAccount
from app.quotas.models import QUOTA_DIMENSIONS, OrgMonthlyUsage, OrgQuota


class QuotaExceeded(ValueError):
    def __init__(self, dimension: str, used: int, limit: int, message: str | None = None) -> None:
        self.dimension = dimension
        self.used = used
        self.limit = limit
        super().__init__(
            message or (
                f"organization quota exceeded for {dimension}: {used} of {limit} used"
            )
        )


class QuotaError(ValueError):
    pass


def _utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def current_period(now: datetime | None = None) -> str:
    return (now or _utc()).strftime("%Y-%m")


def next_period_start(now: datetime | None = None) -> str:
    now = now or _utc()
    year, month = now.year, now.month
    month += 1
    if month > 12:
        month, year = 1, year + 1
    return f"{year:04d}-{month:02d}-01T00:00:00Z"


def default_limits() -> dict[str, int]:
    s = get_settings()
    return {
        "packages": s.org_quota_default_packages,
        "versions": s.org_quota_default_versions,
        "storageBytes": s.org_quota_default_storage_bytes,
        "downloadBytesPerMonth": s.org_quota_default_download_bytes_per_month,
        "members": s.org_quota_default_members,
        "serviceAccounts": s.org_quota_default_service_accounts,
    }


async def effective_limits(session: AsyncSession, organization_id: int) -> tuple[dict[str, int], datetime | None]:
    """Merge registry defaults with the org's active overrides.

    Returns the effective limit dict (all dimensions) and the override expiry
    (``None`` when no override row exists or it has expired).
    """
    limits = default_limits()
    row = (
        await session.execute(select(OrgQuota).where(OrgQuota.organization_id == organization_id))
    ).scalar_one_or_none()
    if row is None or row.overrides_expire_at is None or row.overrides_expire_at <= _utc():
        return limits, None
    for dimension in QUOTA_DIMENSIONS:
        value = row.overrides.get(dimension)
        if value is not None:
            limits[dimension] = int(value)
    return limits, row.overrides_expire_at


async def org_storage_bytes(session: AsyncSession, organization_id: int) -> int:
    from app.registry.models import Agent, AgentVersion

    total = await session.execute(
        select(func.coalesce(func.sum(AgentVersion.archive_bytes), 0))
        .select_from(AgentVersion)
        .join(Agent, Agent.id == AgentVersion.agent_id)
        .where(Agent.organization_id == organization_id)
    )
    return int(total.scalar_one())


async def org_download_bytes(session: AsyncSession, organization_id: int) -> int:
    total = await session.execute(
        select(func.coalesce(func.sum(OrgMonthlyUsage.download_bytes), 0)).where(
            OrgMonthlyUsage.organization_id == organization_id,
            OrgMonthlyUsage.period == current_period(),
        )
    )
    return int(total.scalar_one())


async def org_version_count(session: AsyncSession, organization_id: int) -> int:
    from app.registry.models import Agent, AgentVersion

    count = await session.execute(
        select(func.count(AgentVersion.id))
        .select_from(AgentVersion)
        .join(Agent, Agent.id == AgentVersion.agent_id)
        .where(Agent.organization_id == organization_id)
    )
    return int(count.scalar_one())


async def org_package_count(session: AsyncSession, organization_id: int) -> int:
    from app.registry.models import Agent

    count = await session.execute(
        select(func.count(Agent.id)).where(Agent.organization_id == organization_id)
    )
    return int(count.scalar_one())


async def org_member_count(session: AsyncSession, organization_id: int) -> int:
    count = await session.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == organization_id
        )
    )
    return int(count.scalar_one())


async def org_service_account_count(session: AsyncSession, organization_id: int) -> int:
    count = await session.execute(
        select(func.count(ServiceAccount.id)).where(
            ServiceAccount.organization_id == organization_id,
            ServiceAccount.status == "active",
        )
    )
    return int(count.scalar_one())


async def get_org_usage(session: AsyncSession, organization_id: int) -> dict[str, int]:
    return {
        "packages": await org_package_count(session, organization_id),
        "versions": await org_version_count(session, organization_id),
        "storageBytes": await org_storage_bytes(session, organization_id),
        "downloadBytesThisMonth": await org_download_bytes(session, organization_id),
        "members": await org_member_count(session, organization_id),
        "serviceAccounts": await org_service_account_count(session, organization_id),
    }


def forecast_usage(usage: dict[str, int]) -> dict[str, int | None]:
    """Linear projection of month-to-date download bytes to end-of-month."""
    now = _utc()
    day = now.timetuple().tm_mday
    if day <= 1:
        return {"downloadBytes": None}
    forecast = int(usage["downloadBytesThisMonth"] / day * 30.0)
    return {"downloadBytes": forecast}


async def enforce_publish_quota(
    session: AsyncSession, organization_id: int, *, new_versions: int = 1, new_bytes: int = 0
) -> None:
    """Refuse an org publish that would exceed package/version/storage limits.

    Called inside the publish transaction; the newly-inserted version row is
    part of the same transaction, so the count checks see it via ``flush``.
    """
    limits, _ = await effective_limits(session, organization_id)

    versions = await org_version_count(session, organization_id)
    if versions + new_versions > limits["versions"]:
        raise QuotaExceeded("versions", versions, limits["versions"])

    storage = await org_storage_bytes(session, organization_id) + new_bytes
    if storage > limits["storageBytes"]:
        raise QuotaExceeded("storageBytes", int(storage), limits["storageBytes"])

    packages = await org_package_count(session, organization_id)
    if packages > limits["packages"]:
        raise QuotaExceeded("packages", packages, limits["packages"])


async def enforce_org_member_quota(session: AsyncSession, organization_id: int) -> None:
    limits, _ = await effective_limits(session, organization_id)
    used = await org_member_count(session, organization_id)
    if used >= limits["members"]:
        raise QuotaExceeded("members", used, limits["members"])


async def enforce_service_account_quota(session: AsyncSession, organization_id: int) -> None:
    limits, _ = await effective_limits(session, organization_id)
    used = await org_service_account_count(session, organization_id)
    if used >= limits["serviceAccounts"]:
        raise QuotaExceeded("serviceAccounts", used, limits["serviceAccounts"])


async def enforce_download_quota(
    session: AsyncSession, organization_id: int, *, bytes_to_serve: int
) -> None:
    """Reject an org download that would exceed the monthly bandwidth quota.

    Uses committed ``org_monthly_usage`` plus the download buffer's pending
    (not yet flushed) bytes so enforcement cannot be bypassed by the buffered
    write path.
    """
    limits, _ = await effective_limits(session, organization_id)
    used = await org_download_bytes(session, organization_id)
    from app.registry.downloads import get_download_buffer

    pending = get_download_buffer().pending_org_bytes(organization_id, current_period())
    total = used + pending + bytes_to_serve
    if total > limits["downloadBytesPerMonth"]:
        raise QuotaExceeded("downloadBytesPerMonth", int(total), limits["downloadBytesPerMonth"])


async def get_org_quota_snapshot(session: AsyncSession, organization_id: int) -> dict:
    limits, expiry = await effective_limits(session, organization_id)
    usage = await get_org_usage(session, organization_id)
    return {
        "limits": limits,
        "usage": usage,
        "forecast": forecast_usage(usage),
        "resetDate": next_period_start(),
        "overridesExpireAt": _iso(expiry),
    }


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


async def set_org_quota_overrides(
    session: AsyncSession,
    organization: Organization,
    user: User,
    *,
    limits: dict[str, int] | None,
    ttl_days: int,
) -> dict:
    """Install (or clear) org quota overrides with a bounded lifetime.

    ``overrides=None`` clears any existing override row. Every change is
    audited. Only the owner or an administrator may call this (route-enforced).
    """
    from app.quotas.models import OrgQuota

    if ttl_days > 365:
        raise QuotaError("override TTL cannot exceed 365 days")
    row = (
        await session.execute(
            select(OrgQuota).where(OrgQuota.organization_id == organization.id)
        )
    ).scalar_one_or_none()
    if limits is None or not limits:
        if row is not None:
            await session.delete(row)
        detail = {"slug": organization.slug, "action": "cleared"}
    else:
        unknown = set(limits) - set(QUOTA_DIMENSIONS)
        if unknown:
            raise QuotaError(f"unknown quota dimensions: {', '.join(sorted(unknown))}")
        overrides = {k: int(v) for k, v in limits.items()}
        if any(v < 0 for v in overrides.values()):
            raise QuotaError("quota limits cannot be negative")
        expires = _utc() + timedelta(days=ttl_days)
        if row is None:
            row = OrgQuota(
                organization_id=organization.id,
                overrides=overrides,
                overrides_expire_at=expires,
                created_by_id=user.id,
            )
            session.add(row)
            await session.flush()
        else:
            row.overrides = overrides
            row.overrides_expire_at = expires
        detail = {"slug": organization.slug, "overrides": overrides, "expiresAt": expires.isoformat()}
        await AuditRepository(session).record(
            actor_id=user.id,
            action="organization.quota.override_set",
            target_type="organization",
            target_id=organization.id,
            organization_id=organization.id,
            detail=detail,
        )
    await session.flush()
    limits, expiry = await effective_limits(session, organization.id)
    return {"limits": limits, "overridesExpireAt": _iso(expiry)}