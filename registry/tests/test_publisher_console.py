import uuid

import yaml

from app.db import get_session_factory, utcnow
from app.identity.application import issue_token
from app.identity.models import User
from tests.factories import auth_header, create_user, publish, signed_package


async def _fresh_user(username: str) -> tuple[str, int]:
    async with get_session_factory()() as session:
        user = User(username=username, created_at=utcnow())
        session.add(user)
        await session.commit()
        await session.refresh(user)
        uid = user.id
    return issue_token(uid, username), uid


async def _reviewer(client, role="reviewer"):
    token, uid = await create_user(f"rv-{uuid.uuid4().hex[:6]}")

    async with get_session_factory()() as session:
        user = await session.get(User, uid)
        user.role = role
        await session.commit()
    return token, uid


async def test_overview_reports_console_state(client):
    token, _ = await _fresh_user("publisher-ov")
    archive, sig, _, _ = signed_package("acme", "ov-pkg", "1.0.0")
    await publish(client, token, "acme", "ov-pkg", "1.0.0", archive, sig)

    res = await client.get("/api/v1/me/overview", headers=auth_header(token))
    assert res.status_code == 200
    body = res.json()
    assert body["namespaceCount"] == 1
    assert body["packageCount"] == 1
    assert body["keyCount"] == 1
    assert body["activeSessions"] == 0
    assert body["publishesUsed"] == 1
    assert body["publishesUnlimited"] is False
    assert body["pendingScans"] == 0
    assert body["flaggedVersions"] == 0


async def test_overview_requires_authentication(client):
    assert (await client.get("/api/v1/me/overview")).status_code == 401


async def test_namespaces_lists_membership_and_counts(client):
    token, _ = await create_user("publisher-ns")
    archive, sig, _, _ = signed_package("acme", "ns-pkg", "1.0.0")
    await publish(client, token, "acme", "ns-pkg", "1.0.0", archive, sig)

    res = await client.get("/api/v1/me/namespaces", headers=auth_header(token))
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    ns = items[0]
    assert ns["name"] == "acme"
    assert ns["role"] == "owner"
    assert ns["memberCount"] == 1
    assert ns["packageCount"] == 1


async def test_packages_lists_latest_version_identity(client):
    token, _ = await create_user("publisher-pk")
    archive, sig, _, _ = signed_package("acme", "pk-pkg", "1.0.0")
    await publish(client, token, "acme", "pk-pkg", "1.0.0", archive, sig)

    res = await client.get("/api/v1/me/packages", headers=auth_header(token))
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    pkg = items[0]
    assert pkg["namespace"] == "acme"
    assert pkg["name"] == "pk-pkg"
    assert pkg["version"] == "1.0.0"
    assert pkg["digest"] == sig["sha256"]
    assert pkg["signerFingerprint"] == sig["publicKeyId"]
    assert pkg["reviewStatus"] == "pending"
    assert pkg["yanked"] is False
    assert pkg["blocked"] is None


async def test_version_identity_shows_immutable_data_and_diff(client):
    token, _ = await create_user("publisher-id")
    archive, sig, _, _ = signed_package("acme", "id-pkg", "1.0.0")
    await publish(client, token, "acme", "id-pkg", "1.0.0", archive, sig)

    res = await client.get("/api/v1/me/packages/acme/id-pkg/versions/1.0.0", headers=auth_header(token))
    assert res.status_code == 200
    body = res.json()
    identity = body["identity"]
    assert identity["digest"] == sig["sha256"]
    assert identity["signerFingerprint"] == sig["publicKeyId"]
    assert identity["publishedBy"] == "publisher-id"
    assert identity["reviewStatus"] == "pending"
    assert identity["securityStatus"] == "clean"
    assert identity["yanked"] is False
    assert identity["blocked"] is False
    assert body["manifest"]["name"] == "acme/id-pkg"
    assert body["securityDiff"]["fields"] != []
    assert body["reviewHistory"] == []


async def test_version_identity_shows_permission_diff_from_previous(client):
    token, _ = await create_user("publisher-diff")
    archive, sig, _, _ = signed_package("acme", "diff-pkg", "1.0.0")
    await publish(client, token, "acme", "diff-pkg", "1.0.0", archive, sig)

    from tests.helpers import hello_manifest

    v2_files = {"agent.yaml": yaml.safe_dump(hello_manifest("acme/diff-pkg", "2.0.0", permissions=["network"]))}
    archive2, sig2, _, _ = signed_package("acme", "diff-pkg", "2.0.0", payload=v2_files)
    await publish(client, token, "acme", "diff-pkg", "2.0.0", archive2, sig2)

    res = await client.get("/api/v1/me/packages/acme/diff-pkg/versions/2.0.0", headers=auth_header(token))
    assert res.status_code == 200
    body = res.json()
    assert body["identity"]["version"] == "2.0.0"
    fields = {f["field"] for f in body["securityDiff"]["fields"]}
    assert "permissions" in fields
    assert "digest" in fields
    assert body["securityDiff"]["removedPermissions"] == ["filesystem"]


async def test_version_identity_requires_namespace_membership(client):
    owner_token, _ = await create_user("publisher-owned")
    archive, sig, _, _ = signed_package("acme", "priv-pkg", "1.0.0")
    await publish(client, owner_token, "acme", "priv-pkg", "1.0.0", archive, sig)

    outsider, _ = await create_user("publisher-outsider")
    res = await client.get("/api/v1/me/packages/acme/priv-pkg/versions/1.0.0", headers=auth_header(outsider))
    assert res.status_code == 403


async def test_activity_lists_publish_events(client):
    token, _ = await create_user("publisher-act")
    archive, sig, _, _ = signed_package("acme", "act-pkg", "1.0.0")
    await publish(client, token, "acme", "act-pkg", "1.0.0", archive, sig)

    res = await client.get("/api/v1/me/activity", headers=auth_header(token))
    assert res.status_code == 200
    actions = [i["action"] for i in res.json()["items"]]
    assert "version.published" in actions


async def test_review_queue_lists_pending_versions(client):
    token, _ = await create_user("publisher-queue")
    archive, sig, _, _ = signed_package("acme", "queue-pkg", "1.0.0")
    await publish(client, token, "acme", "queue-pkg", "1.0.0", archive, sig)

    rtoken, _ = await _reviewer(client)
    res = await client.get("/api/v1/admin/review-queue", headers=auth_header(rtoken))
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["namespace"] == "acme"
    assert item["name"] == "queue-pkg"
    assert item["version"] == "1.0.0"
    assert item["digest"] == sig["sha256"]
    assert item["publisher"] == "publisher-queue"
    assert item["reviewStatus"] == "pending"
    assert item["riskScore"] >= 60


async def test_review_queue_denied_for_publishers(client):
    token, _ = await create_user()
    res = await client.get("/api/v1/admin/review-queue", headers=auth_header(token))
    assert res.status_code == 403


async def test_reviewer_cannot_review_own_version(client):
    token, _ = await _reviewer(client)
    archive, sig, _, _ = signed_package("acme", "self-review", "1.0.0")
    await publish(client, token, "acme", "self-review", "1.0.0", archive, sig)

    res = await client.post(
        "/api/v1/admin/agents/acme/self-review/versions/1.0.0/review",
        headers=auth_header(token),
        json={"action": "verify", "reason": "self review"},
    )
    assert res.status_code == 400
    assert "you cannot review a version you published" in res.json()["detail"]


async def test_admin_can_review_own_version(client):
    token, _ = await _reviewer(client, role="admin")
    archive, sig, _, _ = signed_package("acme", "admin-self", "1.0.0")
    await publish(client, token, "acme", "admin-self", "1.0.0", archive, sig)

    res = await client.post(
        "/api/v1/admin/agents/acme/admin-self/versions/1.0.0/review",
        headers=auth_header(token),
        json={"action": "verify", "reason": "admin override allowed"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "verified"


async def test_review_request_changes_sets_status(client):
    token, _ = await create_user("publisher-rc")
    archive, sig, _, _ = signed_package("acme", "rc-pkg", "1.0.0")
    await publish(client, token, "acme", "rc-pkg", "1.0.0", archive, sig)

    rtoken, _ = await _reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/rc-pkg/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "request", "reason": "please document the network calls"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "changes_requested"

    detail = (await client.get("/api/v1/agents/acme/rc-pkg/versions/1.0.0")).json()
    assert detail["reviewStatus"] == "changes_requested"
    assert detail["reviewReason"] == "please document the network calls"


async def test_review_history_appears_in_version_identity(client):
    token, _ = await create_user("publisher-hist")
    archive, sig, _, _ = signed_package("acme", "hist-pkg", "1.0.0")
    await publish(client, token, "acme", "hist-pkg", "1.0.0", archive, sig)

    rtoken, _ = await _reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/hist-pkg/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "verify", "reason": "approved", "notes": "clean"},
    )
    assert res.status_code == 200

    res = await client.get("/api/v1/me/packages/acme/hist-pkg/versions/1.0.0", headers=auth_header(token))
    assert res.status_code == 200
    history = res.json()["reviewHistory"]
    assert len(history) == 1
    assert history[0]["action"] == "verify"
    assert history[0]["reason"] == "approved"
    assert history[0]["notes"] == "clean"
    assert history[0]["digest"] == sig["sha256"]
