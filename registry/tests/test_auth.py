import httpx

import app.identity.application as identity_app
from tests.helpers import hello_manifest, make_archive, make_keypair


class FakeTransport(httpx.AsyncBaseTransport):
    def __init__(self, token_payload, profile_payload, token_status=200, profile_status=200):
        self.token_payload = token_payload
        self.profile_payload = profile_payload
        self.token_status = token_status
        self.profile_status = profile_status

    async def handle_async_request(self, request: httpx.Request):
        if request.url.host == "github.com":
            return httpx.Response(self.token_status, json=self.token_payload)
        if request.url.host == "api.github.com":
            return httpx.Response(self.profile_status, json=self.profile_payload)
        return httpx.Response(500)


async def test_github_login_success(client, monkeypatch):
    monkeypatch.setattr(identity_app, "get_settings", lambda: FakeSettings())
    real_async = httpx.AsyncClient

    def _make(**kw):
        return real_async(transport=FakeTransport({"access_token": "gha-123"}, {"login": "octocat", "id": "42", "avatar_url": "https://x/a.png"}))

    monkeypatch.setattr(identity_app.httpx, "AsyncClient", _make)
    res = await client.post("/api/v1/auth/github", json={"code": "code-abc"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "octocat"
    assert body["token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json()["username"] == "octocat"


async def test_github_login_bad_code(client, monkeypatch):
    monkeypatch.setattr(identity_app, "get_settings", lambda: FakeSettings())
    real_async = httpx.AsyncClient

    def _make(**kw):
        return real_async(transport=FakeTransport({"error": "bad_verification_code"}, {"login": "x"}))

    monkeypatch.setattr(identity_app.httpx, "AsyncClient", _make)
    res = await client.post("/api/v1/auth/github", json={"code": "bad"})
    assert res.status_code == 401


async def test_latest_alias(client):
    from tests.factories import auth_header, create_user, publish, signed_package

    token, _ = await create_user()
    a1, s1, _, _ = signed_package("acme", "ver", "1.0.0")
    a2, s2, _, _ = signed_package("acme", "ver", "2.0.0")
    await publish(client, token, "acme", "ver", "1.0.0", a1, s1)
    await publish(client, token, "acme", "ver", "2.0.0", a2, s2)
    res = await client.get("/api/v1/agents/acme/ver/versions/latest")
    assert res.status_code == 200
    assert res.json()["version"] == "2.0.0"


class FakeSettings:
    github_client_id = "client-id"
    github_client_secret = "client-secret"
    github_token_url = "https://github.com/login/oauth/access_token"
    github_user_url = "https://api.github.com/user"
    jwt_secret = "test-secret-0123456789abcdef0123456789abcdef"
    jwt_algorithm = "HS256"
    token_ttl_seconds = 3600
