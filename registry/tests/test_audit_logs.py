"""Organization and private-package audit logs (M-8.8)."""

import pytest

from app.db import get_session_factory
from tests.factories import auth_header, create_user, signed_package, upload_key


async def _publish(client, token, namespace="acme", name="tool", version="0.1.0"):
    archive, sig, _, pub = signed_package(namespace, name, version)
    await upload_key(client, token, pub)
    return await client.put(
        f"/api/v1/agents/{namespace}/{name}/versions/{version}",
        headers=auth_header(token),
        files={
            "archive": (f"{name}-{version}.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig), "application/json"),
        },
    )


@pytest.mark.asyncio
async def test_org_audit_log_lists_org_events(client):
    token, uid = await create_user("owner-audit")
    org = await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "auditorg", "displayName": "Audit Org"},
    )
    assert org.status_code == 201
    res = await client.get(
        "/api/v1/orgs/auditorg/audit-log", headers=auth_header(token)
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert any(e["action"] == "organization.created" for e in items)
    assert all(e["actorId"] == uid for e in items)


@pytest.mark.asyncio
async def test_org_audit_log_requires_role(client):
    outsider_token, _ = await create_user("outsider-audit")
    res = await client.get(
        "/api/v1/orgs/auditorg/audit-log", headers=auth_header(outsider_token)
    )
    assert res.status_code in (403, 404)


@pytest.mark.asyncio
async def test_org_audit_log_pagination_and_filter(client):
    token, uid = await create_user("owner-paged")
    await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "pagedorg", "displayName": "Paged"},
    )
    res = await client.get(
        "/api/v1/orgs/pagedorg/audit-log",
        headers=auth_header(token),
        params={"limit": 1, "action": "organization.created"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["action"] == "organization.created"
    assert body["nextCursor"] is not None
    page2 = await client.get(
        "/api/v1/orgs/pagedorg/audit-log",
        headers=auth_header(token),
        params={"limit": 1, "action": "organization.created", "before_id": body["nextCursor"]},
    )
    assert page2.status_code == 200
    assert page2.json()["items"] == []


@pytest.mark.asyncio
async def test_package_audit_log_lists_package_events(client):
    token, uid = await create_user("publisher-audit")
    resp = await _publish(client, token)
    assert resp.status_code == 200, resp.text
    res = await client.get(
        "/api/v1/agents/acme/tool/audit-log", headers=auth_header(token)
    )
    assert res.status_code == 200, res.text
    actions = [e["action"] for e in res.json()["items"]]
    assert "version.published" in actions
    assert all(e["namespace"] == "acme" and e["name"] == "tool" for e in res.json()["items"])


@pytest.mark.asyncio
async def test_package_audit_log_private_hidden_from_outsider(client):
    token, uid = await create_user("owner-private")
    resp = await _publish(client, token, namespace="priv", name="secret", version="0.1.0")
    assert resp.status_code == 200, resp.text
    vis = await client.patch(
        "/api/v1/agents/priv/secret/visibility",
        headers=auth_header(token),
        json={"visibility": "private"},
    )
    assert vis.status_code == 200, vis.text
    outsider_token, _ = await create_user("outsider-secret")
    res = await client.get(
        "/api/v1/agents/priv/secret/audit-log", headers=auth_header(outsider_token)
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_visibility_change_is_audited_with_org_scope(client):
    token, uid = await create_user("owner-vis")
    await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "visorg", "displayName": "Vis"},
    )
    resp = await _publish(client, token, namespace="vis", name="thing", version="0.1.0")
    assert resp.status_code == 200, resp.text
    vis = await client.patch(
        "/api/v1/agents/vis/thing/visibility",
        headers=auth_header(token),
        json={"visibility": "internal", "organizationSlug": "visorg"},
    )
    assert vis.status_code == 200, vis.text
    org_log = await client.get(
        "/api/v1/orgs/visorg/audit-log", headers=auth_header(token)
    )
    assert org_log.status_code == 200
    actions = [e["action"] for e in org_log.json()["items"]]
    assert "package.visibility_changed" in actions
    pkg_log = await client.get(
        "/api/v1/agents/vis/thing/audit-log", headers=auth_header(token)
    )
    assert pkg_log.status_code == 200
    assert "package.visibility_changed" in [e["action"] for e in pkg_log.json()["items"]]
    assert all(e["namespace"] == "vis" and e["name"] == "thing" for e in pkg_log.json()["items"])


@pytest.mark.asyncio
async def test_audit_events_never_contain_tokens(client):
    token, uid = await create_user("owner-redact")
    await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "redactorg", "displayName": "Redact"},
    )
    t = await client.post(
        "/api/v1/tokens",
        headers=auth_header(token),
        json={"label": "ci", "scopes": ["packages:read"]},
    )
    assert t.status_code == 201
    raw = t.json()["token"]
    log = await client.get(
        "/api/v1/orgs/redactorg/audit-log", headers=auth_header(token)
    )
    assert log.status_code == 200
    blob = str(log.json())
    assert raw not in blob
    async with get_session_factory()() as s:
        from app.audit.repositories import AuditRepository

        events = await AuditRepository(s).search(action="token.created")
        assert all(raw not in str(e.detail) for e in events)
