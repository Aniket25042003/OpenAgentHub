"""M-8.10 Billing foundation.

Plans and entitlements live in ``app.billing.plans`` and are served as the
base limits for the quota dimensions enforced in ``app.quotas``. This module
owns the subscription lifecycle (trial / active / grace_period / past_due /
suspended / canceled), entitlement snapshots, idempotent webhook processing,
and usage export with explicit retention/deletion rules.

Authorization invariants:
- past_due / suspended / canceled block NEW publishes and uploads only;
- reads, downloads, and existing artifacts are never destroyed by a plan
  transition or payment failure;
- card data never enters the registry (hosted payment provider flow).
"""

import csv
import hashlib
import hmac
import io
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.billing.models import BillingWebhookEvent, OrganizationSubscription
from app.billing.plans import (
    FREE_HANDLE,
    entitlements,
    plan_meta,
    plans,
)
from app.config import get_settings
from app.db import utcnow

_QUOTA_DIMENSIONS = (
    "packages",
    "versions",
    "storageBytes",
    "downloadBytesPerMonth",
    "members",
    "serviceAccounts",
)

WEBHOOK_EVENT_TO_STATUS = {
    "subscription.created": "trial",
    "subscription.activated": "active",
    "invoice.payment_succeeded": "active",
    "subscription.reactivated": "active",
    "subscription.grace_period": "grace_period",
    "invoice.payment_failed": "grace_period",
    "subscription.past_due": "past_due",
    "subscription.suspended": "suspended",
    "subscription.canceled": "canceled",
}

ALLOWED_TRANSITIONS = {
    "trial": {"active", "grace_period", "past_due", "canceled"},
    "active": {"grace_period", "canceled"},
    "grace_period": {"active", "past_due", "canceled"},
    "past_due": {"active", "suspended", "canceled"},
    "suspended": {"active", "canceled"},
    "canceled": {"active"},
}

WRITE_BLOCKED_STATUSES = ("past_due", "suspended", "canceled")

_TIMED_STATUSES = {"trial", "grace_period", "past_due"}


class BillingError(ValueError):
    pass


class BillingBlocked(BillingError):
    def __init__(self, status: str, message: str | None = None) -> None:
        self.status = status
        super().__init__(
            message
            or f"organization billing status '{status}' blocks publishing; "
            "existing packages and downloads are unaffected"
        )


class WebhookSignatureError(BillingError):
    pass


class WebhookEventExists(BillingError):
    pass


def _utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _naive(dt: datetime | None) -> datetime | None:
    """Strip tzinfo to the naive UTC dialect used for storage/compare."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


async def ensure_subscription(session: AsyncSession, organization_id: int) -> OrganizationSubscription:
    """Create the org's subscription row on first use (defaults to trial/free)."""
    row = (
        await session.execute(
            select(OrganizationSubscription).where(
                OrganizationSubscription.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    s = get_settings()
    row = OrganizationSubscription(
        organization_id=organization_id,
        plan=FREE_HANDLE,
        status="trial",
        trial_ends_at=_utc() + timedelta(days=s.billing_trial_days),
        entitlement_snapshot=snapshot_for(FREE_HANDLE, "trial"),
    )
    session.add(row)
    await session.flush()
    if row.status in _TIMED_STATUSES:
        await _schedule_next_pending(session, row)
    return row


def snapshot_for(plan_handle: str, status: str) -> dict:
    return {
        "plan": plan_handle,
        "status": status,
        "entitlements": entitlements(plan_handle),
    }


async def subscription_for(session: AsyncSession, organization_id: int) -> OrganizationSubscription:
    sub = (
        await session.execute(
            select(OrganizationSubscription).where(
                OrganizationSubscription.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if sub is None:
        return await ensure_subscription(session, organization_id)
    return sub


def effective_entitlements(sub: OrganizationSubscription) -> dict:
    """Entitlements currently in effect for the subscription.

    The frozen snapshot wins when present (plan-catalog edits must not
    retroactively change served limits); otherwise the live catalog entry is
    used as the entitlement boundary.
    """
    snapshot = sub.entitlement_snapshot or {}
    snapshot_entitlements = snapshot.get("entitlements")
    if snapshot_entitlements:
        return dict(snapshot_entitlements)
    return entitlements(sub.plan)


async def _enqueue_reconcile(
    session: AsyncSession, organization_id: int, *, at: datetime
) -> None:
    """Produce a billing.reconcile job, deferred to ``at`` (the deadline).

    The dedupe key encodes the deadline so a fresh schedule never collides
    with a previously completed run; jobs are durable and survive restarts.
    """
    from app.outbox.queue import DurableQueue

    await DurableQueue().enqueue(
        session,
        "billing.reconcile",
        {"organizationId": organization_id},
        dedupe_key=f"billing:{organization_id}:{at.isoformat()}",
        run_at=at,
    )


async def _schedule_next_pending(session: AsyncSession, sub: OrganizationSubscription) -> None:
    """Enqueue the next reconcile deadline, if the subscription is in a timed status."""
    now = _utc()
    trial_deadline = _naive(sub.trial_ends_at)
    grace_deadline = _naive(sub.grace_ends_at)
    if sub.status == "trial" and trial_deadline is not None and trial_deadline > now:
        await _enqueue_reconcile(session, sub.organization_id, at=trial_deadline)
        return
    if (
        sub.status == "grace_period"
        and grace_deadline is not None
        and grace_deadline > now
    ):
        await _enqueue_reconcile(session, sub.organization_id, at=grace_deadline)
        return
    if sub.status == "past_due":
        s = get_settings()
        ref = _naive(sub.updated_at) or now
        at = ref + timedelta(days=s.billing_past_due_days)
        await _enqueue_reconcile(session, sub.organization_id, at=max(at, now))


async def transition_status(
    session: AsyncSession,
    sub: OrganizationSubscription,
    new_status: str,
    *,
    actor_id: int | None = None,
    reason: str | None = None,
    via: str = "manual",
) -> OrganizationSubscription:
    """Move a subscription through the lifecycle, snapshotting entitlements.

    Every change is audited with ``organization.billing.status_changed``.
    ``via`` distinguishes manual operator action from provider webhooks.
    """
    if new_status == sub.status:
        return sub
    allowed = ALLOWED_TRANSITIONS.get(sub.status, set())
    if new_status not in allowed:
        raise BillingError(
            f"invalid transition '{sub.status}' -> '{new_status}'"
        )
    old_status = sub.status
    sub.status = new_status
    now = _utc()
    if new_status == "grace_period" and old_status != "grace_period":
        s = get_settings()
        sub.grace_ends_at = now + timedelta(days=s.billing_grace_days)
    if new_status == "canceled":
        sub.canceled_at = now
    if new_status == "active":
        sub.grace_ends_at = None
        sub.canceled_at = None
    sub.entitlement_snapshot = snapshot_for(sub.plan, sub.status)
    if new_status in _TIMED_STATUSES:
        await _schedule_next_pending(session, sub)
    await AuditRepository(session).record(
        actor_id=actor_id,
        action="organization.billing.status_changed",
        target_type="organization",
        target_id=sub.organization_id,
        organization_id=sub.organization_id,
        detail={
            "from": old_status,
            "to": new_status,
            "via": via,
            "reason": reason,
            "plan": sub.plan,
        },
    )
    await session.flush()
    return sub


async def enforce_write_allowed(session: AsyncSession, organization_id: int) -> None:
    """Refuse new publishes/uploads for billing-blocked orgs.

    Reads are never affected: this only gates the write path (publish)."""
    sub = await subscription_for(session, organization_id)
    if sub.status in WRITE_BLOCKED_STATUSES:
        raise BillingBlocked(sub.status)


async def verify_webhook_signature(raw_body: bytes, signature: str | None) -> None:
    s = get_settings()
    if not s.billing_webhook_secret:
        raise WebhookSignatureError(
            "billing webhooks are disabled: REGISTRY_BILLING_WEBHOOK_SECRET is not set"
        )
    if not signature:
        raise WebhookSignatureError("missing X-OpenAgentHub-Signature header")
    expected = hmac.new(
        s.billing_webhook_secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature.lower()):
        raise WebhookSignatureError("webhook signature mismatch")


async def process_webhook(
    session: AsyncSession,
    *,
    organization_id: int,
    provider: str,
    event_id: str,
    event_type: str,
    payload: dict,
) -> dict:
    """Idempotently apply a payment-provider event.

    The (provider, event_id) pair is unique; replays return a duplicate marker
    without re-applying the transition. Card data is never accepted: payloads
    are metadata only.
    """
    existing = (
        await session.execute(
            select(BillingWebhookEvent).where(
                BillingWebhookEvent.provider == provider,
                BillingWebhookEvent.event_id == event_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return {"duplicate": True, "eventId": event_id}

    sub = await subscription_for(session, organization_id)
    event = BillingWebhookEvent(
        organization_id=organization_id,
        provider=provider,
        event_id=event_id,
        event_type=event_type,
        payload=payload or {},
        status="received",
    )
    session.add(event)
    new_status = WEBHOOK_EVENT_TO_STATUS.get(event_type)
    if new_status is None:
        raise BillingError(f"unhandled webhook event type '{event_type}'")
    try:
        await transition_status(
            session, sub, new_status, actor_id=None, reason=event_type, via="webhook"
        )
    except IntegrityError:
        await session.rollback()
        return {"duplicate": True, "eventId": event_id}
    event.status = "processed"
    event.processed_at = utcnow()
    await AuditRepository(session).record(
        actor_id=None,
        action="organization.billing.webhook_processed",
        target_type="organization",
        target_id=organization_id,
        organization_id=organization_id,
        detail={"provider": provider, "eventId": event_id, "eventType": event_type},
    )
    await session.flush()
    return {"duplicate": False, "eventId": event_id, "status": new_status}


async def change_plan(
    session: AsyncSession,
    sub: OrganizationSubscription,
    new_plan: str,
    *,
    actor_id: int | None,
) -> OrganizationSubscription:
    catalog = plans()
    if new_plan not in catalog:
        raise BillingError(f"unknown plan '{new_plan}'")
    launchable = get_settings().billing_launchable_plan_list
    if new_plan not in launchable:
        raise BillingError(f"plan '{new_plan}' is not launchable yet")
    old_plan = sub.plan
    sub.plan = new_plan
    sub.entitlement_snapshot = snapshot_for(new_plan, sub.status)
    await AuditRepository(session).record(
        actor_id=actor_id,
        action="organization.billing.plan_changed",
        target_type="organization",
        target_id=sub.organization_id,
        organization_id=sub.organization_id,
        detail={"from": old_plan, "to": new_plan},
    )
    await session.flush()
    return sub


async def reconcile_subscription(session: AsyncSession, organization_id: int) -> dict:
    """Advance time-based transitions (trial/grace expiry -> past_due/suspended).

    Reconcile never deletes artifacts; it only moves lifecycle state. Called
    by the billing worker for ``billing.reconcile`` jobs and on-demand reads.
    """
    sub = await subscription_for(session, organization_id)
    now = _utc()
    changes = []
    trial_deadline = _naive(sub.trial_ends_at)
    grace_deadline = _naive(sub.grace_ends_at)
    update_ts = _naive(sub.updated_at)
    if sub.status == "trial" and trial_deadline is not None and trial_deadline <= now:
        await transition_status(session, sub, "past_due", reason="trial expired", via="reconcile")
        changes.append("trial->past_due")
    elif (
        sub.status == "grace_period"
        and grace_deadline is not None
        and grace_deadline <= now
    ):
        await transition_status(session, sub, "past_due", reason="grace expired", via="reconcile")
        changes.append("grace_period->past_due")
    elif sub.status == "past_due":
        s = get_settings()
        threshold = now - timedelta(days=s.billing_past_due_days)
        if update_ts is not None and update_ts <= threshold:
            await transition_status(session, sub, "suspended", reason="past due", via="reconcile")
            changes.append("past_due->suspended")
    if sub.status in _TIMED_STATUSES:
        await _schedule_next_pending(session, sub)
    await session.flush()
    return {"organizationId": organization_id, "changes": changes}


async def get_org_billing(session: AsyncSession, organization_id: int) -> dict:
    from app.quotas.application import get_org_quota_snapshot

    sub = await subscription_for(session, organization_id)
    entitle = effective_entitlements(sub)
    meta = plan_meta(sub.plan)
    quota_snapshot = await get_org_quota_snapshot(session, organization_id)
    retention = {
        "auditRetentionDays": entitle.get("auditRetentionDays"),
        "cancelRetentionDays": get_settings().billing_cancel_retention_days,
    }
    return {
        "plan": sub.plan,
        "planName": meta["name"],
        "status": sub.status,
        "supportLevel": meta["supportLevel"],
        "entitlements": entitle,
        "limits": quota_snapshot["limits"],
        "usage": quota_snapshot["usage"],
        "forecast": quota_snapshot["forecast"],
        "resetDate": quota_snapshot["resetDate"],
        "trialEndsAt": _iso(sub.trial_ends_at),
        "graceEndsAt": _iso(sub.grace_ends_at),
        "canceledAt": _iso(sub.canceled_at),
        "retention": retention,
    }


async def export_usage(session: AsyncSession, organization_id: int) -> str:
    """CSV export of current limits/usage plus retention and deletion rules."""
    from app.quotas.application import get_org_quota_snapshot

    sub = await subscription_for(session, organization_id)
    entitle = effective_entitlements(sub)
    snapshot = await get_org_quota_snapshot(session, organization_id)
    s = get_settings()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["dimension", "limit", "usage", "forecast"])
    for dim in _QUOTA_DIMENSIONS:
        writer.writerow(
            [dim, entitle.get(dim), snapshot["usage"].get(dim), snapshot["forecast"].get(dim)]
        )
    writer.writerow([])
    writer.writerow(["retentionRule", "value"])
    writer.writerow(["auditRetentionDays", entitle.get("auditRetentionDays")])
    writer.writerow(["cancelRetentionDays", s.billing_cancel_retention_days])
    writer.writerow(["trialDays", s.billing_trial_days])
    writer.writerow(["graceDays", s.billing_grace_days])
    writer.writerow(["pastDueDays", s.billing_past_due_days])
    writer.writerow(
        ["deletionRule", "artifacts are never destroyed by plan transitions or payment failures"]
    )
    return buffer.getvalue()


async def list_webhook_events(session: AsyncSession, organization_id: int, limit: int = 20) -> list[dict]:
    rows = (
        await session.execute(
            select(BillingWebhookEvent)
            .where(BillingWebhookEvent.organization_id == organization_id)
            .order_by(BillingWebhookEvent.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        {
            "provider": r.provider,
            "eventId": r.event_id,
            "eventType": r.event_type,
            "status": r.status,
            "receivedAt": _iso(r.received_at),
            "processedAt": _iso(r.processed_at),
        }
        for r in rows
    ]
