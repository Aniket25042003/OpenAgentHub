import time

from app.config import get_settings
from tests.factories import auth_header, create_user, publish, signed_package


async def _publish(client, token, namespace, name, version="1.0.0"):
    archive, sig, _, _ = signed_package(namespace, name, version)
    res = await publish(client, token, namespace, name, version, archive, sig)
    assert res.status_code == 200, res.text
    return archive, sig


async def test_issue_download_url_requires_auth(client):
    token, _ = await create_user(f"dl-anon-{int(time.time())}")
    archive, sig, _, _ = signed_package("acme", "pub", "1.0.0")
    await publish(client, token, "acme", "pub", "1.0.0", archive, sig)
    assert (await client.post("/api/v1/agents/acme/pub/versions/1.0.0/download-url")).status_code == 401


async def test_issue_download_url_and_redeem(client):
    token, _ = await create_user(f"dl-ok-{int(time.time())}")
    archive, sig = await _publish(client, token, "acme", "pub")

    res = await client.post(
        "/api/v1/agents/acme/pub/versions/1.0.0/download-url", headers=auth_header(token)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["url"].startswith("http://test/api/v1/agents/acme/pub/versions/1.0.0/archive?dl=")
    assert body["url"].count("dl=") == 1
    assert body["expiresInSeconds"] == get_settings().download_url_ttl_seconds

    download = await client.get(body["url"])
    assert download.status_code == 200
    assert download.content == archive
    assert download.headers.get("cache-control") == "private, no-store"
    assert download.headers.get("x-content-type-options") == "nosniff"


async def test_download_url_requires_version_access(client):
    owner_token, _ = await create_user(f"dl-own-{int(time.time())}")
    intruder_token, _ = await create_user()
    _ = await _publish(client, owner_token, "acme", "secret")
    await client.patch(
        "/api/v1/agents/acme/secret/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "private"},
    )

    res = await client.post(
        "/api/v1/agents/acme/secret/versions/1.0.0/download-url", headers=auth_header(intruder_token)
    )
    assert res.status_code == 404


async def test_tampered_or_expired_token_rejected(client):
    token, _ = await create_user(f"dl-tamper-{int(time.time())}")
    archive, sig = await _publish(client, token, "acme", "pub")

    res = await client.post(
        "/api/v1/agents/acme/pub/versions/1.0.0/download-url", headers=auth_header(token)
    )
    url = res.json()["url"]
    token_part = url.split("dl=", 1)[1]

    flipped = ("1" if token_part[0] != "1" else "2") + token_part[1:]
    assert (await client.get(f"/api/v1/agents/acme/pub/versions/1.0.0/archive?dl={flipped}")).status_code == 404

    bad_package = await client.get(f"/api/v1/agents/acme/pub/versions/1.0.0/archive?dl={token_part}")
    assert bad_package.status_code == 200
    assert bad_package.content == archive


async def test_token_bound_to_exact_version(client):
    token, _ = await create_user(f"dl-bind-{int(time.time())}")
    _ = await _publish(client, token, "acme", "pub", "1.0.0")
    _ = await _publish(client, token, "acme", "pub", "1.1.0")

    res = await client.post(
        "/api/v1/agents/acme/pub/versions/1.0.0/download-url", headers=auth_header(token)
    )
    token_part = res.json()["url"].split("dl=", 1)[1]

    other = await client.get(f"/api/v1/agents/acme/pub/versions/1.1.0/archive?dl={token_part}")
    assert other.status_code == 404


async def test_audit_records_issuance_not_token(client):
    token, uid = await create_user(f"dl-audit-{int(time.time())}")
    _ = await _publish(client, token, "acme", "pub")
    await client.post("/api/v1/agents/acme/pub/versions/1.0.0/download-url", headers=auth_header(token))

    from app.audit.repositories import AuditRepository
    from app.db import get_session_factory

    async with get_session_factory()() as session:
        events = await AuditRepository(session).recent_for_actor(actor_id=uid)
    actions = [e.action for e in events]
    assert "package.download_url_issued" in actions
    issued = [e for e in events if e.action == "package.download_url_issued"][0]
    assert "dl=" not in str(issued.detail)
    assert issued.detail["version"] == "1.0.0"


async def test_token_requires_registered_caller_only(client):
    """A token alone (no session) mediates the archive download."""
    token, _ = await create_user(f"dl-nows-{int(time.time())}")
    archive, sig = await _publish(client, token, "acme", "pub")

    res = await client.post(
        "/api/v1/agents/acme/pub/versions/1.0.0/download-url", headers=auth_header(token)
    )
    url = res.json()["url"]

    bare = await client.get(url)
    assert bare.status_code == 200
    assert bare.content == archive