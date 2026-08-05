from tests.factories import auth_header, create_user, publish, signed_package
from tests.helpers import make_keypair

REVIEWER_USER = None


async def _reviewer():
    global REVIEWER_USER
    return REVIEWER_USER


async def _make_reviewer(client):
    token, uid = await create_user(f"reviewer-{__import__('uuid').uuid4().hex[:6]}")
    from app.db import get_session_factory
    from app.identity.models import User

    async with get_session_factory()() as session:
        user = await session.get(User, uid)
        user.role = "reviewer"
        await session.commit()
    return token, uid


async def test_publish_defaults_to_pending_review(client):
    token, _ = await create_user()
    archive, sig, manifest, _ = signed_package("acme", "review-flow", "1.0.0")
    res = await publish(client, token, "acme", "review-flow", "1.0.0", archive, sig)
    assert res.status_code == 200

    detail = await client.get("/api/v1/agents/acme/review-flow/versions/1.0.0")
    assert detail.status_code == 200
    body = detail.json()
    assert body["reviewStatus"] == "pending"
    assert body["reviewedAt"] is None
    assert body["security"]["status"] == "clean"


async def test_review_verify_sets_verified_with_reason(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "review-verify", "1.0.0")
    await publish(client, token, "acme", "review-verify", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/review-verify/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "verify", "reason": "reviewed manifest and archive manually", "notes": "looks fine"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "verified"

    detail = (await client.get("/api/v1/agents/acme/review-verify/versions/1.0.0")).json()
    assert detail["reviewStatus"] == "verified"
    assert detail["reviewReason"] == "reviewed manifest and archive manually"
    assert detail["reviewedAt"] is not None


async def test_review_requires_reviewer_or_admin(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "review-authz", "1.0.0")
    await publish(client, token, "acme", "review-authz", "1.0.0", archive, sig)

    res = await client.post(
        "/api/v1/admin/agents/acme/review-authz/versions/1.0.0/review",
        headers=auth_header(token),
        json={"action": "verify", "reason": "self-review attempt"},
    )
    assert res.status_code == 403
    assert (await client.post("/api/v1/admin/agents/acme/review-authz/versions/1.0.0/review", json={})).status_code == 401


async def test_review_reject_blocks_download_and_archive(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "review-reject", "1.0.0")
    await publish(client, token, "acme", "review-reject", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/review-reject/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "reject", "reason": "agent reads and exfiltrates config files"},
    )
    assert res.status_code == 200

    dl = await client.get("/api/v1/agents/acme/review-reject/versions/1.0.0/archive")
    assert dl.status_code == 403
    assert "rejected" in dl.json()["detail"]


async def test_review_revoke_appears_in_revocation_feed(client):
    token, _ = await create_user()
    archive, sig, manifest, _ = signed_package("acme", "revoke-feed", "1.0.0")
    await publish(client, token, "acme", "revoke-feed", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/revoke-feed/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "revoke", "reason": "known malicious payload"},
    )
    assert res.status_code == 200

    feed = (await client.get("/api/v1/revocations")).json()
    assert len(feed["items"]) == 1
    item = feed["items"][0]
    assert item["namespace"] == "acme"
    assert item["name"] == "revoke-feed"
    assert item["version"] == "1.0.0"
    assert item["digest"] == __import__("tests.helpers", fromlist=["sha256_hex"]).sha256_hex(archive)
    assert item["reviewStatus"] == "revoked"


async def test_revocation_feed_includes_flagged_versions(client):
    import base64
    import io
    import tarfile

    import yaml

    from tests.helpers import (
        hello_manifest,
        public_key_fingerprint,
        sha256_hex,
        signature_payload,
    )

    token, _ = await create_user()
    key, _, pub = make_keypair()
    full = "acme/flagged-feed"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        data = yaml.safe_dump(hello_manifest(full, "1.0.0")).encode()
        info = tarfile.TarInfo("agent.yaml")
        info.size = len(data)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(data))
        link = tarfile.TarInfo("evil")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        tf.addfile(link)
    archive = buf.getvalue()
    sha = sha256_hex(archive)
    sig = {
        "schemaVersion": 1,
        "name": full,
        "version": "1.0.0",
        "algorithm": "ed25519",
        "publicKey": pub,
        "publicKeyId": public_key_fingerprint(pub),
        "sha256": sha,
        "signature": base64.b64encode(key.sign(signature_payload(full, "1.0.0", sha).encode())).decode(),
    }
    res = await publish(client, token, "acme", "flagged-feed", "1.0.0", archive, sig)
    assert res.status_code == 200
    assert res.json()["security"] == "flagged"

    feed = (await client.get("/api/v1/revocations")).json()
    assert any(i["name"] == "flagged-feed" and i["securityStatus"] == "flagged" for i in feed["items"])

    dl = await client.get("/api/v1/agents/acme/flagged-feed/versions/1.0.0/archive")
    assert dl.status_code == 403


async def test_review_requires_reason_and_valid_action(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "review-reason", "1.0.0")
    await publish(client, token, "acme", "review-reason", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/review-reason/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "verify", "reason": ""},
    )
    assert res.status_code == 400
    res = await client.post(
        "/api/v1/admin/agents/acme/review-reason/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "obliterate", "reason": "nope"},
    )
    assert res.status_code == 422


async def test_rescan_cooldown_rejects_rapid_requests(client):
    from app.config import get_settings

    get_settings().rescan_cooldown_seconds = 10.0
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "scan-cooldown", "1.0.0")
    await publish(client, token, "acme", "scan-cooldown", "1.0.0", archive, sig)

    from datetime import datetime, timezone
    from app.db import get_session_factory
    from app.registry.models import AgentVersion

    async with get_session_factory()() as session:
        ver = (await session.execute(__import__("sqlalchemy", fromlist=["select"]).select(AgentVersion))).scalars().first()
        ver.scan_requested_at = datetime.now(timezone.utc)
        await session.commit()

    res = await client.post(
        "/api/v1/agents/acme/scan-cooldown/versions/1.0.0/scan", headers=auth_header(token)
    )
    assert res.status_code == 429
    assert res.headers.get("Retry-After") == "10"
    get_settings().rescan_cooldown_seconds = 0.0


async def test_review_event_records_digest_and_signer(client):
    token, _ = await create_user()
    archive, sig, manifest, _ = signed_package("acme", "review-immutable", "1.0.0")
    await publish(client, token, "acme", "review-immutable", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    await client.post(
        "/api/v1/admin/agents/acme/review-immutable/versions/1.0.0/review",
        headers=auth_header(rtoken),
        json={"action": "verify", "reason": "approved"},
    )

    from app.db import get_session_factory
    from app.registry.models import VersionReviewEvent

    async with get_session_factory()() as session:
        events = (await session.execute(
            __import__("sqlalchemy", fromlist=["select"]).select(VersionReviewEvent)
        )).scalars().all()
        assert len(events) == 1
        event = events[0]
        assert event.action == "verify"
        assert event.digest == __import__("tests.helpers", fromlist=["sha256_hex"]).sha256_hex(archive)
        assert event.signer_fingerprint == sig["publicKeyId"]
        assert event.reason == "approved"


async def test_yanked_but_not_rejected_still_downloadable(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "yank-only", "1.0.0")
    await publish(client, token, "acme", "yank-only", "1.0.0", archive, sig)

    rtoken, _ = await _make_reviewer(client)
    res = await client.post(
        "/api/v1/admin/agents/acme/yank-only/versions/1.0.0/yank",
        headers=auth_header(rtoken),
        json={"yanked": True},
    )
    assert res.status_code == 200
    dl = await client.get("/api/v1/agents/acme/yank-only/versions/1.0.0/archive")
    assert dl.status_code == 200
