"""M-8.10 Billing foundation."""

import uuid
from datetime import timedelta

from app.db import get_session_factory, utcnow
from app.billing.models import OrganizationSubscription
from tests.factories import auth_header, create_user


async def _make_org(client, owner_token, slug=None):
    slug = slug or f"bill-{uuid.uuid4().hex[:6]}"
    res = await client.post(
        "/api/v1/orgs", headers=auth_header(owner_token), json={"slug": slug, "displayName": slug.title()}
    )
    assert res.status_code == 201, res.text
    return slug


async def _subscription(organization_id: int) -> OrganizationSubscription:
    async with get_session_factory()() as session:
        from sqlalchemy import select

        return (
            await session.execute(
                select(OrganizationSubscription).where(
                    OrganizationSubscription.organization_id == organization_id
                )
            )
        ).scalar_one()


async def test_org_creation_creates_trial_subscription(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/billing", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["plan"] == "free"
    assert body["planName"] == "Free"
    assert body["status"] == "trial"
    assert body["supportLevel"] == "community"
    assert body["entitlements"]["auditRetentionDays"] > 0
    assert body["trialEndsAt"] is not None
    assert body["retention"]["cancelRetentionDays"] > 0
    assert body["usage"]["members"] >= 1


async def test_billing_requires_membership(client):
    outsider_token, _ = await create_user()
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/billing", headers=auth_header(outsider_token))
    assert res.status_code == 403


async def test_transition_state_machine(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)

    async def transition(status, token=None):
        return await client.post(
            f"/api/v1/orgs/{org}/billing/transitions",
            headers=auth_header(token or owner_token),
            json={"status": status, "reason": "test"},
        )

    # trial -> grace_period -> past_due -> suspended -> canceled
    res = await transition("grace_period")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "grace_period"
    assert res.json()["graceEndsAt"] is not None

    res = await transition("past_due")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "past_due"

    res = await transition("suspended")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "suspended"

    res = await transition("canceled")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled"
    assert res.json()["canceledAt"] is not None

    # invalid: canceled -> suspended
    res = await transition("suspended")
    assert res.status_code == 400


async def test_transition_requires_manage_role(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    member_name = f"bill-member-{uuid.uuid4().hex[:6]}"
    member_token, _ = await create_user(member_name)
    await client.post(
        f"/api/v1/orgs/{org}/members",
        headers=auth_header(owner_token),
        json={"username": member_name, "role": "read_only"},
    )
    res = await client.post(
        f"/api/v1/orgs/{org}/billing/transitions",
        headers=auth_header(member_token),
        json={"status": "canceled"},
    )
    assert res.status_code == 403


async def test_billing_manager_role_can_transition(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    bm_name = f"bill-bm-{uuid.uuid4().hex[:6]}"
    bm_token, _ = await create_user(bm_name)
    await client.post(
        f"/api/v1/orgs/{org}/members",
        headers=auth_header(owner_token),
        json={"username": bm_name, "role": "billing_manager"},
    )
    res = await client.post(
        f"/api/v1/orgs/{org}/billing/transitions",
        headers=auth_header(bm_token),
        json={"status": "canceled"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled"


async def _signed(secret: str, payload: dict, headers: dict | None = None):
    """Post a webhook payload with an HMAC-SHA256 signature over the raw body."""
    import hashlib
    import hmac
    import json

    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    hdrs = {"X-OpenAgentHub-Signature": sig, "Content-Type": "application/json"}
    hdrs.update(headers or {})
    return body, hdrs


async def test_webhook_idempotency(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_webhook_secret", "super-secret")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    payload = {
        "provider": "stripe-test",
        "eventId": "evt_1",
        "eventType": "invoice.payment_failed",
        "payload": {"attempt": 1},
    }
    body, hdrs = await _signed("super-secret", payload)
    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", content=body, headers=hdrs)
    assert res.status_code == 200, res.text
    assert res.json()["duplicate"] is False
    assert res.json()["status"] == "grace_period"

    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", content=body, headers=hdrs)
    assert res.status_code == 200, res.text
    assert res.json()["duplicate"] is True

    # state did not move further on replay
    res = await client.get(f"/api/v1/orgs/{org}/billing", headers=auth_header(owner_token))
    assert res.json()["status"] == "grace_period"


async def test_webhook_fail_closed_without_secret(client):
    """Webhook ingress is disabled unless REGISTRY_BILLING_WEBHOOK_SECRET is set."""
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    payload = {
        "provider": "stripe-test",
        "eventId": "evt_nosecret",
        "eventType": "subscription.suspended",
        "payload": {},
    }
    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", json=payload)
    assert res.status_code == 400
    assert "REGISTRY_BILLING_WEBHOOK_SECRET" in res.text


async def test_webhook_signature_required_when_secret_set(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_webhook_secret", "super-secret")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    payload = {
        "provider": "stripe-test",
        "eventId": "evt_2",
        "eventType": "subscription.canceled",
        "payload": {},
    }
    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", json=payload)
    assert res.status_code == 400
    assert "X-OpenAgentHub-Signature" in res.text


async def test_webhook_rejects_bad_signature(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_webhook_secret", "super-secret")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    payload = {
        "provider": "stripe-test",
        "eventId": "evt_2b",
        "eventType": "subscription.canceled",
        "payload": {},
    }
    body, hdrs = await _signed("not-the-secret", payload)
    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", content=body, headers=hdrs)
    assert res.status_code == 400


async def test_webhook_unknown_event_type(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_webhook_secret", "super-secret")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    payload = {"provider": "stripe-test", "eventId": "evt_3", "eventType": "invoice.refunded", "payload": {}}
    body, hdrs = await _signed("super-secret", payload)
    res = await client.post(f"/api/v1/orgs/{org}/billing/webhooks", content=body, headers=hdrs)
    assert res.status_code == 400


async def test_suspended_org_publish_blocked_but_reads_ok(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)

    from tests.factories import publish, upload_key
    from tests.helpers import hello_manifest, make_archive, make_keypair

    key, priv, pub = make_keypair()
    manifest1 = hello_manifest(f"{org}/pkg-a", "1.0.0")
    archive1, sig1 = make_archive(
        f"{org}/pkg-a", "1.0.0", manifest1,
        {"agent.yaml": __import__("yaml").safe_dump(manifest1), "app.py": "print('hi')\n"},
        key, pub,
    )
    await upload_key(client, owner_token, pub)
    res = await publish(client, owner_token, org, "pkg-a", "1.0.0", archive1, sig1)
    assert res.status_code == 200, res.text
    res = await client.patch(
        f"/api/v1/agents/{org}/pkg-a/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "internal", "organizationSlug": org},
    )
    assert res.status_code == 200, res.text

    async def transition(status):
        return await client.post(
            f"/api/v1/orgs/{org}/billing/transitions",
            headers=auth_header(owner_token),
            json={"status": status, "reason": "test"},
        )

    res = await transition("past_due")
    assert res.status_code == 200, res.text
    res = await transition("suspended")
    assert res.status_code == 200, res.text

    manifest2 = hello_manifest(f"{org}/pkg-a", "1.1.0")
    archive2, sig2 = make_archive(
        f"{org}/pkg-a", "1.1.0", manifest2,
        {"agent.yaml": __import__("yaml").safe_dump(manifest2), "app.py": "print('hi2')\n"},
        key, pub,
    )
    res = await client.put(
        f"/api/v1/agents/{org}/pkg-a/versions/1.1.0",
        headers=auth_header(owner_token),
        files={
            "archive": ("pkg-a-1.1.0.ahb", archive2, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig2), "application/json"),
        },
    )
    assert res.status_code == 403
    assert "X-Billing-Status" in res.headers
    assert res.headers["X-Billing-Status"] == "suspended"

    res = await client.get(
        f"/api/v1/agents/{org}/pkg-a/versions/1.0.0/archive",
        headers=auth_header(owner_token),
    )
    assert res.status_code == 200, res.text


async def test_publish_before_suspension_then_download_after(client):
    """Artifacts published before a transition remain downloadable after."""
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)

    from tests.factories import publish, signed_package

    archive, sig, manifest, pub = signed_package(org, "pkg-b", "1.0.0")
    res = await publish(client, owner_token, org, "pkg-b", "1.0.0", archive, sig)
    assert res.status_code == 200, res.text

    res = await client.post(
        f"/api/v1/orgs/{org}/billing/transitions",
        headers=auth_header(owner_token),
        json={"status": "canceled"},
    )
    assert res.status_code == 200, res.text

    res = await client.get(f"/api/v1/agents/{org}/pkg-b/versions/1.0.0/archive")
    assert res.status_code == 200, res.text


async def test_plan_change_updates_entitlements(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_launchable_plans", "free,pro")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.put(
        f"/api/v1/orgs/{org}/billing/plan",
        headers=auth_header(owner_token),
        json={"plan": "pro"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["plan"] == "pro"
    assert body["entitlements"]["members"] > 100


async def test_plan_change_rejects_non_launchable(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.put(
        f"/api/v1/orgs/{org}/billing/plan",
        headers=auth_header(owner_token),
        json={"plan": "enterprise"},
    )
    assert res.status_code == 400


async def test_usage_export_csv(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/billing/usage-export", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    text = res.text
    assert "dimension,limit,usage,forecast" in text
    assert "storageBytes" in text
    assert "auditRetentionDays" in text
    assert "never destroyed" in text


async def test_reconcile_advances_expired_trial(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    from sqlalchemy import select

    from app.organizations.models import Organization

    async with get_session_factory()() as session:
        org_row = (
            await session.execute(select(Organization).where(Organization.slug == org))
        ).scalar_one()
        sub = (
            await session.execute(
                select(OrganizationSubscription).where(
                    OrganizationSubscription.organization_id == org_row.id
                )
            )
        ).scalar_one()
        sub.trial_ends_at = utcnow() - timedelta(days=1)
        await session.commit()

    # expired trial must move to past_due via the on-demand read path
    res = await client.get(f"/api/v1/orgs/{org}/billing", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "past_due"

    # the transition must be durable (persisted, not rolled back at request end)
    async with get_session_factory()() as session:
        sub = (
            await session.execute(
                select(OrganizationSubscription).where(
                    OrganizationSubscription.organization_id == org_row.id
                )
            )
        ).scalar_one()
        assert sub.status == "past_due"


async def test_grace_expiry_moves_to_past_due_via_scheduled_job(client):
    """A trial's scheduled reconcile fires at expiry and re-schedules the next deadline."""
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)

    from sqlalchemy import select

    from app.billing.application import reconcile_subscription
    from app.outbox.models import QueueJob
    from app.organizations.models import Organization

    async with get_session_factory()() as session:
        org_row = (
            await session.execute(select(Organization).where(Organization.slug == org))
        ).scalar_one()
        sub = (
            await session.execute(
                select(OrganizationSubscription).where(
                    OrganizationSubscription.organization_id == org_row.id
                )
            )
        ).scalar_one()
        # expire the trial now
        sub.trial_ends_at = utcnow() - timedelta(days=1)
        await session.commit()

        # the reconcile job the subscription seeded earlier is deferred to the
        # trial deadline; move trial->past_due and confirm a past_due job exists
        before = (
            await session.execute(select(QueueJob).where(QueueJob.job_type == "billing.reconcile"))
        ).scalars().all()
        await reconcile_subscription(session, org_row.id)
        await session.commit()
        after = (
            await session.execute(select(QueueJob).where(QueueJob.job_type == "billing.reconcile"))
        ).scalars().all()
        assert sub.status == "past_due"
        new_jobs = [
            j
            for j in after
            if j.id not in {b.id for b in before}
            and j.dedupe_key.startswith(f"billing:{org_row.id}:")
        ]
        assert new_jobs, "expected a deferred follow-up reconcile job after trial expiry"


async def test_entitlements_flow_into_quota_limits(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "billing_launchable_plans", "free,pro")
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.put(
        f"/api/v1/orgs/{org}/billing/plan",
        headers=auth_header(owner_token),
        json={"plan": "pro"},
    )
    assert res.status_code == 200, res.text
    res = await client.get(f"/api/v1/orgs/{org}/quota", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    assert res.json()["limits"]["members"] > 100


async def test_billing_audit_events_recorded(client):
    owner_token, _ = await create_user(f"bill-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    await client.post(
        f"/api/v1/orgs/{org}/billing/transitions",
        headers=auth_header(owner_token),
        json={"status": "canceled"},
    )
    res = await client.get(f"/api/v1/orgs/{org}/audit-log", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    actions = [item["action"] for item in res.json()["items"]]
    assert "organization.billing.status_changed" in actions
