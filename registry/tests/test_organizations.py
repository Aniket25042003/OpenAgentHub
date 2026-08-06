import uuid
from datetime import timedelta

from app.db import get_session_factory, utcnow
from app.organizations.models import Invitation
from tests.factories import auth_header, create_user


async def _owner(username: str):
    return await create_user(username)


async def test_create_organization(client):
    token, _ = await _owner(f"org-owner-{uuid.uuid4().hex[:6]}")
    res = await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "acme", "displayName": "Acme Corp"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["slug"] == "acme"
    assert body["displayName"] == "Acme Corp"
    assert body["status"] == "active"
    assert body["role"] == "owner"


async def test_create_organization_requires_auth(client):
    assert (await client.post("/api/v1/orgs", json={"slug": "x", "displayName": "X"})).status_code == 401


async def test_create_organization_duplicate_slug_conflicts(client):
    token, _ = await _owner(f"org-dup-{uuid.uuid4().hex[:6]}")
    payload = {"slug": "acme", "displayName": "Acme Corp"}
    assert (await client.post("/api/v1/orgs", headers=auth_header(token), json=payload)).status_code == 201
    res = await client.post("/api/v1/orgs", headers=auth_header(token), json=payload)
    assert res.status_code == 409


async def test_create_organization_rejects_invalid_slug(client):
    token, _ = await _owner(f"org-bad-{uuid.uuid4().hex[:6]}")
    res = await client.post(
        "/api/v1/orgs",
        headers=auth_header(token),
        json={"slug": "Not Valid!", "displayName": "Bad"},
    )
    assert res.status_code == 400


async def test_list_my_organizations(client):
    token, _ = await _owner(f"org-list-{uuid.uuid4().hex[:6]}")
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"})
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "globex", "displayName": "Globex"})
    res = await client.get("/api/v1/orgs", headers=auth_header(token))
    assert res.status_code == 200
    slugs = [item["slug"] for item in res.json()]
    assert slugs == ["acme", "globex"]
    assert all(item["role"] == "owner" for item in res.json())


async def test_get_organization_detail(client):
    token, _ = await _owner(f"org-get-{uuid.uuid4().hex[:6]}")
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.get("/api/v1/orgs/acme", headers=auth_header(token))
    assert res.status_code == 200
    body = res.json()
    assert body["slug"] == "acme"
    assert body["myRole"] == "owner"
    assert body["memberCount"] == 1


async def test_get_organization_denies_non_members(client):
    owner_token, _ = await _owner(f"org-nm-{uuid.uuid4().hex[:6]}")
    stranger_token, _ = await create_user()
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.get("/api/v1/orgs/acme", headers=auth_header(stranger_token))
    assert res.status_code == 403


async def test_update_organization_name(client):
    token, _ = await _owner(f"org-up-{uuid.uuid4().hex[:6]}")
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.patch(
        "/api/v1/orgs/acme", headers=auth_header(token), json={"displayName": "Acme Inc"}
    )
    assert res.status_code == 200
    detail = await client.get("/api/v1/orgs/acme", headers=auth_header(token))
    assert detail.json()["displayName"] == "Acme Inc"


async def test_add_member_and_list(client):
    owner_token, _ = await _owner(f"org-am-{uuid.uuid4().hex[:6]}")
    member_token, member_uid = await create_user("member-alice")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-alice", "role": "maintainer"},
    )
    assert res.status_code == 201

    members = await client.get("/api/v1/orgs/acme/members", headers=auth_header(owner_token))
    assert members.status_code == 200
    items = members.json()["items"]
    assert {"username": "member-alice", "role": "maintainer"} in items

    detail = await client.get("/api/v1/orgs/acme", headers=auth_header(member_token))
    assert detail.json()["myRole"] == "maintainer"


async def test_add_member_requires_privilege(client):
    owner_token, _ = await _owner(f"org-pr-{uuid.uuid4().hex[:6]}")
    member_token, _ = await create_user("member-bob")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-bob", "role": "read_only"},
    )
    res = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(member_token),
        json={"username": "member-eve", "role": "read_only"},
    )
    assert res.status_code == 403


async def test_add_member_rejects_unknown_user(client):
    token, _ = await _owner(f"org-uu-{uuid.uuid4().hex[:6]}")
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(token),
        json={"username": "nobody-known", "role": "maintainer"},
    )
    assert res.status_code == 400


async def test_maintainer_cannot_grant_administrator(client):
    owner_token, _ = await _owner(f"org-esc-{uuid.uuid4().hex[:6]}")
    maintainer_token, _ = await create_user("maintainer-eve")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "maintainer-eve", "role": "maintainer"},
    )
    await create_user("member-mallory")

    escalated = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(maintainer_token),
        json={"username": "member-mallory", "role": "administrator"},
    )
    assert escalated.status_code == 403

    same = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(maintainer_token),
        json={"username": "member-mallory", "role": "maintainer"},
    )
    assert same.status_code == 201

    invite = await client.post(
        "/api/v1/orgs/acme/invitations",
        headers=auth_header(maintainer_token),
        json={"username": "member-mallory", "role": "administrator"},
    )
    assert invite.status_code == 403


async def test_change_member_role_and_transfer_ownership(client):
    owner_token, _ = await _owner(f"org-tr-{uuid.uuid4().hex[:6]}")
    _, other_uid = await create_user("member-carol")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-carol", "role": "maintainer"},
    )
    res = await client.patch(
        "/api/v1/orgs/acme/members/member-carol",
        headers=auth_header(owner_token),
        json={"role": "owner"},
    )
    assert res.status_code == 200

    members = await client.get("/api/v1/orgs/acme/members", headers=auth_header(owner_token))
    by_name = {item["username"]: item["role"] for item in members.json()["items"]}
    assert by_name["member-carol"] == "owner"


async def test_remove_member_and_leave(client):
    owner_token, _ = await _owner(f"org-rm-{uuid.uuid4().hex[:6]}")
    member_token, member_uid = await create_user("member-dave")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-dave", "role": "read_only"},
    )
    res = await client.delete("/api/v1/orgs/acme/members/member-dave", headers=auth_header(owner_token))
    assert res.status_code == 200

    detail = await client.get("/api/v1/orgs/acme", headers=auth_header(member_token))
    assert detail.status_code == 403


async def test_owner_cannot_leave_until_successor_exists(client):
    owner_token, _ = await _owner(f"org-lv-{uuid.uuid4().hex[:6]}")
    await create_user("member-frank")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.delete("/api/v1/orgs/acme/leave", headers=auth_header(owner_token))
    assert res.status_code == 403

    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-frank", "role": "maintainer"},
    )
    res = await client.patch(
        "/api/v1/orgs/acme/members/member-frank", headers=auth_header(owner_token), json={"role": "owner"}
    )
    assert res.status_code == 200
    res = await client.delete("/api/v1/orgs/acme/leave", headers=auth_header(owner_token))
    assert res.status_code == 200


async def test_invite_and_accept_flow(client):
    owner_token, _ = await _owner(f"org-inv-{uuid.uuid4().hex[:6]}")
    invitee_token, invitee_uid = await create_user("invitee-grace")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.post(
        "/api/v1/orgs/acme/invitations",
        headers=auth_header(owner_token),
        json={"username": "invitee-grace", "role": "maintainer"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["token"] and body["expiresInHours"] == 72

    res = await client.post(
        "/api/v1/orgs/invitations/accept",
        headers=auth_header(invitee_token),
        json={"token": body["token"]},
    )
    assert res.status_code == 200
    assert res.json()["slug"] == "acme"
    assert res.json()["role"] == "maintainer"

    detail = await client.get("/api/v1/orgs/acme", headers=auth_header(invitee_token))
    assert detail.json()["myRole"] == "maintainer"


async def test_invitation_single_use(client):
    owner_token, _ = await _owner(f"org-inv2-{uuid.uuid4().hex[:6]}")
    invitee_token, _ = await create_user("invitee-henry")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.post(
        "/api/v1/orgs/acme/invitations",
        headers=auth_header(owner_token),
        json={"username": "invitee-henry", "role": "read_only"},
    )
    token = res.json()["token"]
    assert (
        await client.post(
            "/api/v1/orgs/invitations/accept", headers=auth_header(invitee_token), json={"token": token}
        )
    ).status_code == 200
    res = await client.post(
        "/api/v1/orgs/invitations/accept", headers=auth_header(invitee_token), json={"token": token}
    )
    assert res.status_code == 400


async def test_expired_invitation_rejected(client):
    import hashlib

    owner_token, owner_uid = await _owner(f"org-exp-{uuid.uuid4().hex[:6]}")
    invitee_token, invitee_uid = await create_user("invitee-iris")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})

    expires_token = "expired-token"
    async with get_session_factory()() as session:
        from sqlalchemy import select

        from app.organizations.models import Organization

        org = (
            await session.execute(select(Organization).where(Organization.slug == "acme"))
        ).scalar_one()
        session.add(
            Invitation(
                organization_id=org.id,
                invited_by_id=owner_uid,
                role="read_only",
                token_hash=hashlib.sha256(expires_token.encode()).hexdigest(),
                email="invitee-iris",
                expires_at=utcnow() - timedelta(hours=1),
            )
        )
        await session.commit()

    res = await client.post(
        "/api/v1/orgs/invitations/accept", headers=auth_header(invitee_token), json={"token": expires_token}
    )
    assert res.status_code == 410


async def test_list_invitations_requires_privilege(client):
    owner_token, _ = await _owner(f"org-li-{uuid.uuid4().hex[:6]}")
    member_token, _ = await create_user("member-justin")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-justin", "role": "read_only"},
    )
    res = await client.get("/api/v1/orgs/acme/invitations", headers=auth_header(member_token))
    assert res.status_code == 403


async def test_teams_crud(client):
    owner_token, _ = await _owner(f"org-tm-{uuid.uuid4().hex[:6]}")
    member_token, _ = await create_user("member-kate")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(owner_token),
        json={"username": "member-kate", "role": "maintainer"},
    )
    res = await client.post(
        "/api/v1/orgs/acme/teams", headers=auth_header(owner_token), json={"name": "platform"}
    )
    assert res.status_code == 201
    team_id = res.json()["id"]

    res = await client.post(
        f"/api/v1/orgs/acme/teams/{team_id}/members",
        headers=auth_header(owner_token),
        json={"username": "member-kate"},
    )
    assert res.status_code == 200

    teams = await client.get("/api/v1/orgs/acme/teams", headers=auth_header(owner_token))
    assert teams.status_code == 200
    items = teams.json()["items"]
    assert items == [{"id": team_id, "name": "platform", "memberCount": 1}]

    res = await client.delete(
        f"/api/v1/orgs/acme/teams/{team_id}/members/member-kate", headers=auth_header(owner_token)
    )
    assert res.status_code == 200
    teams = await client.get("/api/v1/orgs/acme/teams", headers=auth_header(owner_token))
    assert teams.json()["items"][0]["memberCount"] == 0


async def test_team_membership_requires_org_membership(client):
    owner_token, _ = await _owner(f"org-tm2-{uuid.uuid4().hex[:6]}")
    outsider_token, _ = await create_user("outsider-lucy")
    await client.post("/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"})
    res = await client.post(
        "/api/v1/orgs/acme/teams", headers=auth_header(owner_token), json={"name": "platform"}
    )
    team_id = res.json()["id"]
    res = await client.post(
        f"/api/v1/orgs/acme/teams/{team_id}/members",
        headers=auth_header(owner_token),
        json={"username": "outsider-lucy"},
    )
    assert res.status_code == 400


async def test_audit_events_recorded(client):
    token, uid = await _owner(f"org-au-{uuid.uuid4().hex[:6]}")
    await client.post("/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"})
    async with get_session_factory()() as session:
        from app.audit.repositories import AuditRepository

        events = await AuditRepository(session).recent_for_actor(actor_id=uid)
        actions = [e.action for e in events]
    assert "organization.created" in actions
