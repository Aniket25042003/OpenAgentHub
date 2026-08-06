"""M-9.1 Account self-service: profile, security events, account deletion."""

import uuid

import pytest

import app.identity.application as identity_app
import app.identity.sessions as sessions_mod
from app.db import get_session_factory
from app.identity.models import Session, User
from sqlalchemy import select

from tests.factories import auth_header

SESSION_COOKIE = "oah_session"


class FakeSessionSettings:
    github_client_id = "client-id"
    github_client_secret = "client-secret"
    github_token_url = "https://github.com/login/oauth/access_token"
    github_user_url = "https://api.github.com/user"
    github_authorize_url = "https://github.com/login/oauth/authorize"
    jwt_secret = "test-secret-0123456789abcdef0123456789abcdef"
    jwt_algorithm = "HS256"
    token_ttl_seconds = 3600
    web_redirect_uris = "http://localhost:3100/auth/callback,http://localhost:8000/auth/callback"
    session_cookie_name = SESSION_COOKIE
    session_absolute_ttl_seconds = 604800
    session_idle_ttl_seconds = 1209600
    session_rotate_after_seconds = 3600
    current_tos_version = 1
    current_privacy_version = 1
    current_publisher_agreement_version = 1
    public_base_url = "http://localhost:8000"


@pytest.fixture
def session_settings(monkeypatch):
    settings = FakeSessionSettings()
    monkeypatch.setattr(identity_app, "get_settings", lambda: settings)
    monkeypatch.setattr(sessions_mod, "get_settings", lambda: settings)
    return settings


async def _cookie_user(client, session_settings, username=None, github_id="77") -> tuple[int, str]:
    username = username or f"acct-{uuid.uuid4().hex[:8]}"
    async with get_session_factory()() as s:
        user = User(username=username, github_id=github_id)
        s.add(user)
        await s.commit()
        await s.refresh(user)
        token, _ = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()
        uid = user.id
    client.cookies.set(SESSION_COOKIE, token)
    return uid, token


async def _user_by_id(uid: int) -> User:
    async with get_session_factory()() as s:
        return await s.get(User, uid)


async def _sessions_for(uid: int) -> list[Session]:
    async with get_session_factory()() as s:
        return list((await s.execute(select(Session).where(Session.user_id == uid))).scalars())


async def test_profile_endpoint(client, session_settings):
    uid, _ = await _cookie_user(client, session_settings)
    res = await client.get("/api/v1/me/profile")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["githubId"] == "77"
    assert body["status"] == "active"
    assert body["role"] == "publisher"
    assert body["agreements"]["tos"] == "pending"


async def test_profile_requires_auth(client, session_settings):
    res = await client.get("/api/v1/me/profile")
    assert res.status_code == 401


async def test_security_events_endpoint(client, session_settings):
    uid, _ = await _cookie_user(client, session_settings)
    res = await client.get("/api/v1/me/security-events")
    assert res.status_code == 200, res.text
    events = res.json()["events"]
    assert isinstance(events, list)
    actions = {e["action"] for e in events}
    assert "session.created" in actions
    assert all("createdAt" in e for e in events)


async def test_delete_requires_confirmation(client, session_settings):
    uid, _ = await _cookie_user(client, session_settings)
    res = await client.post("/api/v1/me/delete", json={"confirm": "wrong"})
    assert res.status_code == 400
    user = await _user_by_id(uid)
    assert user.status == "active"


async def test_delete_closes_account_and_revokes(client, session_settings):
    uid, token = await _cookie_user(client, session_settings)
    res = await client.post("/api/v1/me/delete", json={"confirm": "delete-account"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "deleted"
    user = await _user_by_id(uid)
    assert user.status == "deleted"
    for row in await _sessions_for(uid):
        assert row.revoked_at is not None
    async with get_session_factory()() as s:
        with pytest.raises(Exception):
            await sessions_mod.session_user(s, token)


async def test_delete_blocks_second_call(client, session_settings):
    uid, _ = await _cookie_user(client, session_settings)
    first = await client.post("/api/v1/me/delete", json={"confirm": "delete-account"})
    assert first.status_code == 200
    second = await client.post("/api/v1/me/delete", json={"confirm": "delete-account"})
    assert second.status_code in (401, 403)


async def test_delete_removes_org_memberships(client, session_settings):
    from app.organizations.application import create_organization
    from app.organizations.models import OrganizationMember

    owner_uid, owner_token = await _cookie_user(
        client, session_settings, username=f"own-{uuid.uuid4().hex[:6]}", github_id="88"
    )
    uid, token = await _cookie_user(client, session_settings)
    slug = f"org-{uuid.uuid4().hex[:6]}"
    async with get_session_factory()() as s:
        org = await create_organization(
            s, await s.get(User, owner_uid), slug=slug, display_name=slug.title()
        )
        member = await s.get(User, uid)
        from app.organizations.repositories import OrganizationRepository

        await OrganizationRepository(s).add_member(org, member.id, "read_only")
        await s.commit()
        org_id = org.id
    del client.cookies[SESSION_COOKIE]
    res = await client.post(
        "/api/v1/me/delete", json={"confirm": "delete-account"}, headers=auth_header(token)
    )
    assert res.status_code == 200, res.text
    async with get_session_factory()() as s:
        rows = list(
            (
                await s.execute(
                    select(OrganizationMember).where(OrganizationMember.organization_id == org_id)
                )
            ).scalars()
        )
        assert len(rows) == 1
        assert rows[0].user_id == owner_uid


async def test_delete_blocked_as_sole_owner(client, session_settings):
    from app.organizations.application import create_organization

    uid, token = await _cookie_user(client, session_settings)
    slug = f"org-{uuid.uuid4().hex[:6]}"
    async with get_session_factory()() as s:
        user = await s.get(User, uid)
        await create_organization(s, user, slug=slug, display_name=slug.title())
        await s.commit()
    res = await client.post("/api/v1/me/delete", json={"confirm": "delete-account"})
    assert res.status_code == 409
    user = await _user_by_id(uid)
    assert user.status == "active"


async def test_deleted_user_login_rejected(client, session_settings, monkeypatch):
    uid, _ = await _cookie_user(client, session_settings, github_id="42")
    await client.post("/api/v1/me/delete", json={"confirm": "delete-account"})

    async def _fake_exchange(code):
        return "octocat", "42", "https://x/a.png"

    monkeypatch.setattr(identity_app, "exchange_github_code", _fake_exchange)
    async with get_session_factory()() as s:
        from fastapi import HTTPException

        from app.identity.application import login_with_github

        with pytest.raises(HTTPException) as exc:
            await login_with_github(s, "code")
        assert exc.value.status_code == 403
