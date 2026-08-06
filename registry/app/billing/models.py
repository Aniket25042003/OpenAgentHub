from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, JSONType, utcnow

SUBSCRIPTION_STATUSES = (
    "trial",
    "active",
    "grace_period",
    "past_due",
    "suspended",
    "canceled",
)

WEBHOOK_EVENT_STATUSES = ("received", "processed", "duplicate", "failed")


class OrganizationSubscription(Base):
    """Per-organization billing state (M-8.10).

    One row per organization. ``plan`` selects the entitlement catalog entry
    from ``app.billing.plans``; the entitlements that were in effect when the
    subscription reached its current status are frozen in
    ``entitlement_snapshot`` so plan-catalog edits never retroactively change
    an organization's served limits.

    Status is a lifecycle, not an authorization flag: past-due/suspended/
    canceled organizations keep read access to their artifacts; only new
    publishes/uploads are blocked. Nothing is destroyed on plan transitions.
    """

    __tablename__ = "organization_subscriptions"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_subscription"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    plan: Mapped[str] = mapped_column(String(32), default="free")
    status: Mapped[str] = mapped_column(
        String(24), default="trial", index=True
    )
    entitlement_snapshot: Mapped[dict] = mapped_column(JSONType, default=dict)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    grace_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class BillingWebhookEvent(Base):
    """Idempotent inbound billing webhook (M-8.10).

    Payment-provider events are recorded before they are applied; the unique
    (provider, event_id) constraint makes replay a no-op. Payloads never
    contain card data: the registry only ingests event metadata and state
    transitions, never PANs or CVVs.
    """

    __tablename__ = "billing_webhook_events"
    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_billing_webhook_event"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    event_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="received")
    received_at: Mapped[datetime] = mapped_column(default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
