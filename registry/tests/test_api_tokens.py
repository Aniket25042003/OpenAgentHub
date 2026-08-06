"""API tokens and organization CI service accounts (M-8.7)."""

import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.db import get_session_factory
from app.identity.api_tokens import TOKEN_SCOPES, create_api_token
from app.identity.models import ApiToken, User
from tests.factories import create_user


@pytest.mark.asyncio
async def test_create_token_returns_raw_once(client):
    token, uid = await create_user()
    res = await client.post(
        "/api/v1/tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"label": "ci", "scopes": ["packages:read"]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["token"].startswith("oah_")
    assert body["prefix"] == body["token"][:12]
    assert body["scopes"] == ["packages:read"]
    async with get_session_factory()() as s:
        row = await s.get(ApiToken, body["id"])
        assert row is not None
        assert row.token_hash == hashlib.sha256(body["token"].encode()).hexdigest()
        assert row.prefix == body["prefix"]


@pytest.mark.asyncio
async def test_token_list_masks_secret(client):
    token, uid = await create_user()
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, _ = await create_api_token(s, user, label="ci", scopes=["packages:read"])
        await s.commit()
    res = await client.get("/api/v1/tokens", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["label"] == "ci"
    assert items[0]["prefix"] == raw[:12]
    assert "token" not in items[0]


@pytest.mark.asyncio
async def test_revoke_token_immediately(client):
    token, uid = await create_user()
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, row = await create_api_token(s, user, label="ci", scopes=["packages:read"])
        await s.commit()
    res = await client.delete(
        f"/api/v1/tokens/{row.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert res.json()["revoked"] is True
    protected = await client.get(
        "/api/v1/tokens", headers={"Authorization": f"Bearer {raw}"}
    )
    assert protected.status_code == 401


@pytest.mark.asyncio
async def test_rotate_token_revokes_old(client):
    token, uid = await create_user()
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, row = await create_api_token(s, user, label="ci", scopes=["packages:read"])
        await s.commit()
    res = await client.post(
        f"/api/v1/tokens/{row.id}/rotate",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token"] != raw
    old = await client.get("/api/v1/tokens", headers={"Authorization": f"Bearer {raw}"})
    assert old.status_code == 401
    new = await client.get("/api/v1/tokens", headers={"Authorization": f"Bearer {body['token']}"})
    assert new.status_code == 200


@pytest.mark.asyncio
async def test_token_scopes_reject_manage(client):
    token, uid = await create_user()
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, _ = await create_api_token(s, user, label="ci", scopes=["packages:read"])
        await s.commit()
    res = await client.patch(
        "/api/v1/agents/acme/tool/visibility",
        headers={"Authorization": f"Bearer {raw}"},
        json={"visibility": "private"},
    )
    assert res.status_code == 403
    assert "lacks required scope" in res.json()["detail"]


@pytest.mark.asyncio
async def test_token_invalid_scope_rejected(client):
    token, uid = await create_user()
    res = await client.post(
        "/api/v1/tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"label": "bad", "scopes": ["packages:explode"]},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_token_expired_rejected(client):
    token, uid = await create_user()
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, row = await create_api_token(
            s, user, label="old", scopes=["packages:read"], expires_in_days=1
        )
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        await s.commit()
    res = await client.get("/api/v1/tokens", headers={"Authorization": f"Bearer {raw}"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_token_max_per_account(client):
    token, uid = await create_user()
    limit = get_settings().token_max_per_account
    for i in range(limit):
        res = await client.post(
            "/api/v1/tokens",
            headers={"Authorization": f"Bearer {token}"},
            json={"label": f"t{i}", "scopes": ["packages:read"]},
        )
        assert res.status_code == 201
    res = await client.post(
        "/api/v1/tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"label": "overflow", "scopes": ["packages:read"]},
    )
    assert res.status_code == 429


@pytest.mark.asyncio
async def test_service_account_lifecycle(client):
    token, uid = await create_user("owner-person")
    org = await client.post(
        "/api/v1/orgs",
        headers={"Authorization": f"Bearer {token}"},
        json={"slug": "acmecorp", "displayName": "Acme Corp"},
    )
    assert org.status_code == 201, org.text
    created = await client.post(
        "/api/v1/orgs/acmecorp/service-accounts",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "ci-deploy", "role": "maintainer"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "ci-deploy"

    listing = await client.get(
        "/api/v1/orgs/acmecorp/service-accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listing.status_code == 200
    assert len(listing.json()["items"]) == 1

    sa_id = created.json()["id"]
    deleted = await client.delete(
        f"/api/v1/orgs/acmecorp/service-accounts/{sa_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert deleted.status_code == 200

    listing = await client.get(
        "/api/v1/orgs/acmecorp/service-accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listing.json()["items"] == []


@pytest.mark.asyncio
async def test_service_account_requires_owner_or_admin(client):
    token, uid = await create_user()
    res = await client.post(
        "/api/v1/orgs",
        headers={"Authorization": f"Bearer {token}"},
        json={"slug": "lowlyorg", "displayName": "Lowly"},
    )
    assert res.status_code == 201
    outsider_token, _ = await create_user()
    denied = await client.post(
        "/api/v1/orgs/lowlyorg/service-accounts",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"name": "ci-deploy", "role": "maintainer"},
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_scopes_enumeration_complete():
    expected = {
        "packages:read",
        "packages:publish",
        "packages:manage",
        "keys:manage",
        "members:manage",
        "audit:read",
        "billing:read",
        "billing:manage",
    }
    assert set(TOKEN_SCOPES) == expected


@pytest.mark.asyncio
async def test_read_only_token_cannot_yank_or_manage_members(client):
    from tests.factories import auth_header, publish, signed_package

    token, uid = await create_user()
    archive, sig, _, _ = signed_package("acme", "pkg", "1.0.0")
    await publish(client, token, "acme", "pkg", "1.0.0", archive, sig)
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        raw, _ = await create_api_token(s, user, label="ro", scopes=["packages:read"])
        await s.commit()

    yanked = await client.post(
        "/api/v1/admin/agents/acme/pkg/versions/1.0.0/yank",
        headers=auth_header(raw),
        json={"yanked": True},
    )
    assert yanked.status_code == 403

    await client.post(
        "/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"}
    )
    await create_user("member-eve-readonly")
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(token),
        json={"username": "member-eve-readonly", "role": "read_only"},
    )
    member = await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(raw),
        json={"username": "member-eve-readonly", "role": "read_only"},
    )
    assert member.status_code == 403


@pytest.mark.asyncio
async def test_org_scoped_token_works_for_member(client):
    from tests.factories import auth_header

    token, uid = await create_user()
    member_token, _ = await create_user("org-member-ced")
    await client.post(
        "/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"}
    )
    await client.post(
        "/api/v1/orgs/acme/members",
        headers=auth_header(token),
        json={"username": "org-member-ced", "role": "maintainer"},
    )
    org = None
    from app.organizations.models import Organization

    from sqlalchemy import select

    async with get_session_factory()() as s:
        org = (await s.execute(select(Organization).where(Organization.slug == "acme"))).scalar_one()

    res = await client.post(
        "/api/v1/tokens",
        headers=auth_header(member_token),
        json={"label": "org-ci", "scopes": ["packages:read"], "organizationId": org.id},
    )
    assert res.status_code == 201, res.text


@pytest.mark.asyncio
async def test_mint_token_scoped_to_foreign_org_rejected(client):
    from app.organizations.models import Organization
    from sqlalchemy import select

    from tests.factories import auth_header

    owner_token, _ = await create_user()
    stranger_token, _ = await create_user("org-stranger-mint")
    await client.post(
        "/api/v1/orgs", headers=auth_header(owner_token), json={"slug": "acme", "displayName": "Acme"}
    )
    async with get_session_factory()() as s:
        org = (await s.execute(select(Organization).where(Organization.slug == "acme"))).scalar_one()
        await s.commit()
    res = await client.post(
        "/api/v1/tokens",
        headers=auth_header(stranger_token),
        json={"label": "other-org", "scopes": ["packages:read"], "organizationId": org.id},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_issue_service_account_token_sets_org_and_sa_flag(client):
    from tests.factories import auth_header

    token, uid = await create_user()
    await client.post(
        "/api/v1/orgs", headers=auth_header(token), json={"slug": "acme", "displayName": "Acme"}
    )
    sa = await client.post(
        "/api/v1/orgs/acme/service-accounts",
        headers=auth_header(token),
        json={"name": "ci", "role": "maintainer"},
    )
    assert sa.status_code == 201, sa.text
    sa_id = sa.json()["id"]

    minted = await client.post(
        f"/api/v1/orgs/acme/service-accounts/{sa_id}/tokens",
        headers=auth_header(token),
        json={"label": "ci-key", "scopes": ["packages:read"]},
    )
    assert minted.status_code == 201, minted.text
    body = minted.json()
    assert body["token"].startswith("oah_")
    async with get_session_factory()() as s:
        row = await s.get(ApiToken, body["id"])
        assert row.is_service_account is True
        assert row.organization_id is not None