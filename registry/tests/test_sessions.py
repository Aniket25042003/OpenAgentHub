from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

import app.identity.application as identity_app
import app.identity.oauth as oauth_mod
import app.identity.sessions as sessions_mod
from app.db import get_session_factory
from app.identity.models import Session, User


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
    session_cookie_name = "oah_session"
    session_absolute_ttl_seconds = 604800
    session_idle_ttl_seconds = 1209600
    session_rotate_after_seconds = 3600
    session_cookie_domain = ""
    session_cookie_secure = None
    device_login_ttl_seconds = 900
    device_approve_per_ip_per_hour = 60
    current_tos_version = 1
    current_privacy_version = 1
    current_publisher_agreement_version = 1
    public_base_url = "http://localhost:8000"


@pytest.fixture
def session_settings(monkeypatch):
    settings = FakeSessionSettings()
    monkeypatch.setattr(identity_app, "get_settings", lambda: settings)
    monkeypatch.setattr(sessions_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(oauth_mod, "get_settings", lambda: settings)
    return settings


class FakeTransport(httpx.AsyncBaseTransport):
    def __init__(self, token_payload, profile_payload):
        self.token_payload = token_payload
        self.profile_payload = profile_payload

    async def handle_async_request(self, request: httpx.Request):
        if request.url.host == "github.com":
            return httpx.Response(200, json=self.token_payload)
        if request.url.host == "api.github.com":
            return httpx.Response(200, json=self.profile_payload)
        return httpx.Response(500)


def _patch_github(monkeypatch):
    real_async = httpx.AsyncClient

    def _make(**kw):
        return real_async(
            transport=FakeTransport({"access_token": "gha-123"}, {"login": "octocat", "id": "42", "avatar_url": "https://x/a.png"})
        )

    monkeypatch.setattr(identity_app.httpx, "AsyncClient", _make)


async def _octocat() -> User:
    async with get_session_factory()() as s:
        user = User(username="octocat", github_id="42", avatar_url="https://x/a.png")
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


async def test_session_create_resolve(client, session_settings):
    user = await _octocat()
    async with get_session_factory()() as s:
        token, row = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()
        resolved, new_token = await sessions_mod.session_user(s, token)
        assert resolved.username == "octocat"
        assert new_token is None
        assert row.token_hash != token


async def test_session_rotation(client, session_settings):
    user = await _octocat()
    async with get_session_factory()() as s:
        token, row = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()
        row.last_used_at = datetime.now(timezone.utc) - timedelta(seconds=4000)
        await s.commit()
        _, new_token = await sessions_mod.session_user(s, token)
        assert new_token is not None and new_token != token
        u2, again = await sessions_mod.session_user(s, new_token)
        assert u2.username == "octocat"
        assert again is None


async def test_session_expired(client, session_settings):
    from fastapi import HTTPException

    user = await _octocat()
    async with get_session_factory()() as s:
        token, row = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        await s.commit()
        with pytest.raises(HTTPException) as exc:
            await sessions_mod.session_user(s, token)
        assert exc.value.status_code == 401


async def test_session_revoke(client, session_settings):
    from fastapi import HTTPException

    user = await _octocat()
    async with get_session_factory()() as s:
        token, row = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()
        await sessions_mod.revoke_by_id(s, row.id, user)
        await s.commit()
        with pytest.raises(HTTPException) as exc:
            await sessions_mod.session_user(s, token)
        assert exc.value.status_code == 401


async def test_suspend_revokes_sessions(client, session_settings):
    from app.identity.application import suspend_user
    from app.identity.models import User as U

    actor = User(username="admin", github_id="99")
    async with get_session_factory()() as s:
        s.add(actor)
        await s.commit()
        await s.refresh(actor)
        user = await _octocat()
        token, _ = await sessions_mod.create_session(s, user, audience="cli")
        await s.commit()
        await suspend_user(s, actor, user.id, True)
        await s.commit()
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await sessions_mod.session_user(s, token)
        assert exc.value.status_code == 401


def test_state_token_roundtrip(client, session_settings):
    tok = oauth_mod.make_state_token(redirect_uri="http://localhost:3100/auth/callback")
    data = oauth_mod.verify_state_token(tok)
    assert data["r"] == "http://localhost:3100/auth/callback"
    assert oauth_mod.verify_state_token("garbage") is None
    bad = tok[:20] + ("A" if tok[20] != "A" else "B") + tok[21:]
    assert oauth_mod.verify_state_token(bad) is None


def test_redirect_allowlist(client, session_settings):
    assert oauth_mod.is_allowed_redirect("http://localhost:3100/auth/callback")
    assert not oauth_mod.is_allowed_redirect("https://evil.example/cb")


async def test_oauth_start_and_callback(client, session_settings, monkeypatch):
    _patch_github(monkeypatch)
    res = await client.get("/auth/github/start", params={"redirect_uri": "http://localhost:3100/auth/callback"})
    assert res.status_code == 302
    loc = res.headers["location"]
    assert loc.startswith("https://github.com/login/oauth/authorize")
    state = parse_qs(urlparse(loc).query)["state"][0]
    res2 = await client.get("/auth/github/callback", params={"code": "code-abc", "state": state})
    assert res2.status_code == 302
    assert "oah_session=" in res2.headers["set-cookie"]
    assert res2.headers["location"] == "http://localhost:3100/auth/callback?ok=1"


async def test_oauth_rejects_bad_state(client, session_settings):
    res = await client.get("/auth/github/callback", params={"code": "x", "state": "forged"})
    assert res.status_code == 400


async def test_device_flow(client, session_settings, monkeypatch):
    from app.identity.repositories import UserRepository

    _patch_github(monkeypatch)
    user = await _octocat()
    start = await client.post("/api/v1/auth/devices", json={"clientName": "cli"})
    assert start.status_code == 200
    data = start.json()
    user_code = data["userCode"]
    device_code = data["deviceCode"]
    assert data["verificationUri"].startswith("http://localhost:8000/device")
    poll = await client.post("/api/v1/auth/devices/token", json={"deviceCode": device_code})
    assert poll.status_code == 400
    assert poll.json()["detail"] == "authorization_pending"

    async with get_session_factory()() as s:
        await sessions_mod.approve_device_login(s, user, user_code)
        await s.commit()

    poll = await client.post("/api/v1/auth/devices/token", json={"deviceCode": device_code})
    assert poll.status_code == 200
    body = poll.json()
    assert body["accessToken"]
    assert body["username"] == "octocat"
    assert body["tokenType"] == "bearer"

    replay = await client.post("/api/v1/auth/devices/token", json={"deviceCode": device_code})
    assert replay.status_code == 400
    assert replay.json()["detail"] == "expired_token"


async def test_device_approve_origin_mismatch(client, session_settings):
    user = await _octocat()
    start = await client.post("/api/v1/auth/devices", json={"clientName": "cli"})
    data = start.json()
    async with get_session_factory()() as s:
        token, _ = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()

    res = await client.post(
        "/api/v1/auth/approve",
        params={"user_code": data["userCode"]},
        cookies={"oah_session": token},
        headers={"Origin": "https://evil.example"},
    )
    assert res.status_code == 403

    ok = await client.post(
        "/api/v1/auth/approve",
        params={"user_code": data["userCode"]},
        cookies={"oah_session": token},
        headers={"Origin": "http://localhost:8000"},
    )
    assert ok.status_code == 200


async def test_logout_revokes_session(client, session_settings):
    user = await _octocat()
    async with get_session_factory()() as s:
        token, _ = await sessions_mod.create_session(s, user, audience="web")
        await s.commit()

    res = await client.post("/api/v1/logout", cookies={"oah_session": token})
    assert res.status_code == 200

    from fastapi import HTTPException

    async with get_session_factory()() as s:
        with pytest.raises(HTTPException) as exc:
            await sessions_mod.session_user(s, token)
        assert exc.value.status_code == 401


async def test_cookie_domain_and_secure(client, session_settings):
    session_settings.session_cookie_domain = "openagenthub.dev"
    session_settings.session_cookie_secure = True
    val = oauth_mod.cookie_value("tok")
    assert "Domain=openagenthub.dev" in val
    assert "Secure" in val
    session_settings.session_cookie_domain = ""
    session_settings.session_cookie_secure = None
    assert "Domain=" not in oauth_mod.cookie_value("tok")


async def test_agreements_flow(client, session_settings):
    from app.identity.repositories import UserRepository

    user = await _octocat()
    assert sessions_mod.agreements_status(user)["tos"] == "pending"
    async with get_session_factory()() as s:
        status = await sessions_mod.accept_agreements(s, user, True, True, True)
        await s.commit()
        assert status["tos"] == "accepted"
        assert await sessions_mod.publisher_ready(s, user)


def test_cookie_value(client, session_settings):
    val = oauth_mod.cookie_value("tok", max_age_seconds=60)
    assert "oah_session=tok" in val
    assert "HttpOnly" in val
    assert "Max-Age=60" in val
    assert "SameSite=Lax" in val
    assert "Secure" not in val
    secure = oauth_mod.cookie_value("tok")
    assert "Secure" not in secure


async def test_list_sessions_and_status(client, session_settings):
    user = await _octocat()
    async with get_session_factory()() as s:
        t1, _ = await sessions_mod.create_session(s, user, audience="web")
        t2, _ = await sessions_mod.create_session(s, user, audience="cli", device_label="macbook")
        await s.commit()
        rows = await sessions_mod.list_for_user(s, user)
        assert len(rows) == 2
        assert {r.audience for r in rows} == {"web", "cli"}

    client.cookies.set("oah_session", t1)
    res = await client.get("/api/v1/sessions")
    assert res.status_code == 200
    body = res.json()
    assert len(body["sessions"]) == 2

    res2 = await client.delete("/api/v1/sessions/" + str(rows[0].id))
    assert res2.status_code == 200

    res3 = await client.get("/api/v1/me/agreements")
    assert res3.status_code == 200
    assert res3.json()["tos"] == "pending"