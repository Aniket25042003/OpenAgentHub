from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, JSONType, utcnow

QUOTA_DIMENSIONS = (
    "packages",
    "versions",
    "storageBytes",
    "downloadBytesPerMonth",
    "members",
    "serviceAccounts",
)


class OrgQuota(Base):
    """Per-organization quota overrides (M-8.9).

    A single optional row per organization. ``overrides`` is a JSON dict of
    dimension -> limit for the dimensions in ``QUOTA_DIMENSIONS``; dimensions
    absent from the dict fall back to the registry defaults. ``overrides_expire_at``
    bounds how long administrator-set overrides remain in effect, and every write
    is recorded in the audit trail.
    """

    __tablename__ = "org_quotas"
    __table_args__ = (UniqueConstraint("organization_id", name="uq_org_quota"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    overrides: Mapped[dict] = mapped_column(JSONType, default=dict)
    overrides_expire_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class OrgMonthlyUsage(Base):
    """Aggregated download bytes per organization per UTC month.

    Update once per month lets quota consumers compute current-month
    bandwidth usage with a single indexed lookup instead of scanning each
    download event. Written by the download-count buffer flush (M-8.6) so a
    download never causes a synchronous per-request DB write.
    """

    __tablename__ = "org_monthly_usage"
    __table_args__ = (
        UniqueConstraint("organization_id", "period", name="uq_org_monthly_usage"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    period: Mapped[str] = mapped_column(String(7), index=True)
    download_bytes: Mapped[int] = mapped_column(default=0)
    download_count: Mapped[int] = mapped_column(default=0)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)