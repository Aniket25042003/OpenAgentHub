import uuid

from tests.factories import auth_header, create_user, publish, signed_package


async def _publish(client, token, namespace, name, version="1.0.0"):
    archive, sig, _, _ = signed_package(namespace, name, version)
    res = await publish(client, token, namespace, name, version, archive, sig)
    assert res.status_code == 200, res.text
    return res.json()


async def test_read_endpoints_require_visibility(client):
    owner_token, _ = await create_user(f"vis-owner-{uuid.uuid4().hex[:6]}")
    stranger_token, _ = await create_user()
    _ = await _publish(client, owner_token, "acme", "secret")

    res = await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "private"},
    )
    assert res.status_code == 200
    assert res.json()["visibility"] == "private"

    for path in (
        "/api/v1/agents/acme/secret",
        "/api/v1/agents/acme/secret/versions",
        "/api/v1/agents/acme/secret/versions/1.0.0",
    ):
        assert (await client.get(path)).status_code == 404, path
        assert (await client.get(path, headers=auth_header(stranger_token))).status_code == 404, path

    assert (await client.get("/api/v1/agents/acme/secret/versions/1.0.0/archive")).status_code == 404


async def test_owner_can_read_private_package(client):
    token, _ = await create_user(f"vis-own-{uuid.uuid4().hex[:6]}")
    _ = await _publish(client, token, "acme", "secret")
    await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(token),
        json={"visibility": "private"},
    )
    assert (await client.get("/api/v1/agents/acme/secret", headers=auth_header(token))).status_code == 200


async def test_invalid_visibility_rejected(client):
    token, _ = await create_user(f"vis-bad-{uuid.uuid4().hex[:6]}")
    _ = await _publish(client, token, "acme", "secret")
    res = await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(token),
        json={"visibility": "shady"},
    )
    assert res.status_code == 400


async def test_set_visibility_requires_manager(client):
    owner_token, owner_uid = await create_user(f"vis-mgr-{uuid.uuid4().hex[:6]}")
    intruder_token, _ = await create_user()
    _ = await _publish(client, owner_token, "acme", "secret")
    res = await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(intruder_token),
        json={"visibility": "private"},
    )
    assert res.status_code == 400


async def test_user_grant_and_revoke(client):
    owner_token, _ = await create_user(f"vis-gr-{uuid.uuid4().hex[:6]}")
    guest_token, _ = await create_user("guest-mallory")
    _ = await _publish(client, owner_token, "acme", "secret")
    await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "private"},
    )

    assert (
        await client.get("/api/v1/agents/acme/secret", headers=auth_header(guest_token))
    ).status_code == 404

    res = await client.post(
        "/api/v1/agents/acme/secret/grants",
        headers=auth_header(owner_token),
        json={"username": "guest-mallory"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["username"] == "guest-mallory"
    assert (
        await client.get("/api/v1/agents/acme/secret", headers=auth_header(guest_token))
    ).status_code == 200

    grants = await client.get("/api/v1/agents/acme/secret/grants", headers=auth_header(owner_token))
    assert grants.status_code == 200
    items = grants.json()
    assert len(items) == 1
    assert items[0]["type"] == "user"
    assert items[0]["userId"] is not None

    res = await client.request(
        "DELETE",
        "/api/v1/agents/acme/secret/grants",
        headers=auth_header(owner_token),
        json={"username": "guest-mallory"},
    )
    assert res.status_code == 200
    assert (
        await client.get("/api/v1/agents/acme/secret", headers=auth_header(guest_token))
    ).status_code == 404


async def test_internal_requires_org_membership(client):
    owner_token, owner_uid = await create_user(f"vis-org-{uuid.uuid4().hex[:6]}")
    member_token, _ = await create_user("org-member-nina")
    outsider_token, _ = await create_user()
    await client.post(
        "/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"}
    )
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "org-member-nina", "role": "read_only"},
    )
    _ = await _publish(client, owner_token, "acme", "internal-agent")
    res = await client.patch(
        "/api/v1/agents/acme/internal-agent/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "internal", "organizationSlug": "acme"},
    )
    assert res.status_code == 200, res.text

    assert (
        await client.get("/api/v1/agents/acme/internal-agent", headers=auth_header(outsider_token))
    ).status_code == 404
    assert (
        await client.get("/api/v1/agents/acme/internal-agent", headers=auth_header(member_token))
    ).status_code == 200


async def test_team_grant_grants_org_members(client):
    owner_token, _ = await create_user(f"vis-tm-{uuid.uuid4().hex[:6]}")
    member_token, _ = await create_user("member-olive")
    _ = await _publish(client, owner_token, "acme", "secret")
    await client.post(
        "/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"}
    )
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-olive", "role": "maintainer"},
    )
    await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "private"},
    )
    team_id = (
        await client.post(
            "/api/v1/orgs/acme/teams", headers=auth_header(owner_token), json={"name": "platform"}
        )
    ).json()["id"]
    await client.post(
        f"/api/v1/orgs/acme/teams/{team_id}/members",
        headers=auth_header(owner_token),
        json={"username": "member-olive"},
    )
    res = await client.post(
        "/api/v1/agents/acme/secret/grants",
        headers=auth_header(owner_token),
        json={"teamId": team_id},
    )
    assert res.status_code == 200, res.text
    assert res.json()["teamId"] == team_id
    assert (
        await client.get("/api/v1/agents/acme/secret", headers=auth_header(member_token))
    ).status_code == 200


async def test_catalog_and_search_never_leak_private(client):
    token, _ = await create_user(f"vis-leak-{uuid.uuid4().hex[:6]}")
    _ = await _publish(client, token, "acme", "secret")
    await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(token),
        json={"visibility": "private"},
    )

    search = await client.get("/api/v1/agents", params={"q": "secret"})
    assert search.status_code == 200
    assert not search.json()["items"]

    catalog = await client.get("/api/v1/catalog")
    assert catalog.status_code == 200
    assert all(i["name"] != "secret" for i in catalog.json()["items"])