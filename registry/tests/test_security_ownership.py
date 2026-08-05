import base64
import io
import json
import tarfile
from datetime import datetime, timedelta, timezone

import yaml

from app.db import get_session_factory, utcnow
from app.identity.application import issue_token
from app.identity.models import User
from tests.factories import auth_header, create_user, publish, signed_package, upload_key
from tests.helpers import hello_manifest, make_archive, make_keypair, public_key_fingerprint, sha256_hex


async def raw_put(client, token, namespace, name, version, archive, sig):
    return await client.put(
        f"/api/v1/agents/{namespace}/{name}/versions/{version}",
        headers=auth_header(token),
        files={
            "archive": (f"{name}-{version}.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", json.dumps(sig), "application/json"),
        },
    )


async def test_publish_requires_registered_key(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "k1", "1.0.0")
    res = await client.put(
        "/api/v1/agents/acme/k1/versions/1.0.0",
        headers=auth_header(token),
        files={
            "archive": ("k1-1.0.0.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", json.dumps(sig), "application/json"),
        },
    )
    assert res.status_code == 403
    assert "not registered" in res.text


async def test_cross_account_publish_rejected(client):
    owner_token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "locked", "1.0.0")
    assert (await publish(client, owner_token, "acme", "locked", "1.0.0", archive, sig)).status_code == 200
    intruder_token, _ = await create_user()
    archive2, sig2, _, _ = signed_package("acme", "locked", "2.0.0")
    res = await publish(client, intruder_token, "acme", "locked", "2.0.0", archive2, sig2)
    assert res.status_code == 403


async def test_revoked_key_rejected_and_rotation_works(client):
    token, _ = await create_user()
    full = "acme/rot"
    manifest = hello_manifest(full, "1.0.0")
    manifest_v2 = hello_manifest(full, "2.0.0")

    key_a, _, pub_a = make_keypair()
    files_a = {"agent.yaml": yaml.safe_dump(manifest), "app.py": "print(1)\n"}
    archive_a, sig_a = make_archive(full, "1.0.0", manifest, files_a, key_a, pub_a)
    key_id = (await upload_key(client, token, pub_a, label="ci"))["id"]
    assert (await raw_put(client, token, "acme", "rot", "1.0.0", archive_a, sig_a)).status_code == 200

    key_b, _, pub_b = make_keypair()
    files_b = {"agent.yaml": yaml.safe_dump(manifest_v2), "app.py": "print(2)\n"}
    archive_b, sig_b = make_archive(full, "2.0.0", manifest_v2, files_b, key_b, pub_b)
    await upload_key(client, token, pub_b, label="ci-2")
    assert (await raw_put(client, token, "acme", "rot", "2.0.0", archive_b, sig_b)).status_code == 200

    res = await client.delete(f"/api/v1/keys/{key_id}", headers=auth_header(token))
    assert res.status_code == 200

    manifest_v3 = hello_manifest(full, "3.0.0")
    files_a3 = {"agent.yaml": yaml.safe_dump(manifest_v3), "app.py": "print(3)\n"}
    archive_a3, sig_a3 = make_archive(full, "3.0.0", manifest_v3, files_a3, key_a, pub_a)
    res = await raw_put(client, token, "acme", "rot", "3.0.0", archive_a3, sig_a3)
    assert res.status_code == 403
    assert "revoked" in res.text

    me = (await client.get("/api/v1/me", headers=auth_header(token))).json()
    revoked = [k for k in me["publicKeys"] if k["fingerprint"] == sig_a["publicKeyId"]]
    assert revoked and revoked[0]["revoked"] is True


async def test_wrong_user_key_rejected(client):
    owner_token, _ = await create_user()
    other_token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "wk", "1.0.0")
    await upload_key(client, owner_token, sig["publicKey"])
    res = await raw_put(client, other_token, "acme", "wk", "1.0.0", archive, sig)
    assert res.status_code == 403


async def test_expired_key_rejected(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "exp", "1.0.0")
    expires = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await upload_key(client, token, sig["publicKey"], expiresAt=expires)
    res = await raw_put(client, token, "acme", "exp", "1.0.0", archive, sig)
    assert res.status_code == 403
    assert "expired" in res.text


async def test_key_cannot_be_uploaded_by_second_account(client):
    first_token, _ = await create_user()
    second_token, _ = await create_user()
    _, _, pub = make_keypair()
    await upload_key(client, first_token, pub)
    res = await client.post("/api/v1/keys", headers=auth_header(second_token), json={"publicKey": pub})
    assert res.status_code == 409


async def test_revoke_requires_ownership(client):
    owner_token, _ = await create_user()
    other_token, _ = await create_user()
    _, _, pub = make_keypair()
    key_id = (await upload_key(client, owner_token, pub))["id"]
    res = await client.delete(f"/api/v1/keys/{key_id}", headers=auth_header(other_token))
    assert res.status_code == 403


async def test_signer_key_status_surfaced_in_detail(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "sig", "1.0.0")
    assert (await publish(client, token, "acme", "sig", "1.0.0", archive, sig)).status_code == 200
    detail = (await client.get("/api/v1/agents/acme/sig/versions/1.0.0")).json()
    assert detail["signerKey"]["revoked"] is False
    assert detail["signerKey"]["fingerprint"] == sig["publicKeyId"]
    key_id = (await client.get("/api/v1/me", headers=auth_header(token))).json()["publicKeys"][0]["id"]
    await client.delete(f"/api/v1/keys/{key_id}", headers=auth_header(token))
    detail = (await client.get("/api/v1/agents/acme/sig/versions/1.0.0")).json()
    assert detail["signerKey"]["revoked"] is True


async def test_reserved_namespace_rejected(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("openagenthub", "core", "1.0.0")
    res = await publish(client, token, "openagenthub", "core", "1.0.0", archive, sig)
    assert res.status_code == 403
    res = await client.post("/api/v1/namespaces", headers=auth_header(token), json={"name": "github-actions"})
    assert res.status_code == 403


async def test_maintainer_acl(client):
    owner_token, owner_id = await create_user("owner-acl")
    maint_token, _ = await create_user("maintainer-acl")
    archive, sig, _, _ = signed_package("acl", "app", "1.0.0")
    assert (await publish(client, owner_token, "acl", "app", "1.0.0", archive, sig)).status_code == 200

    archive2, sig2, _, _ = signed_package("acl", "app", "2.0.0")
    res = await publish(client, maint_token, "acl", "app", "2.0.0", archive2, sig2)
    assert res.status_code == 403

    res = await client.post(
        "/api/v1/namespaces/acl/maintainers",
        headers=auth_header(owner_token),
        json={"username": "maintainer-acl", "role": "maintainer"},
    )
    assert res.status_code == 200
    archive3, sig3, _, _ = signed_package("acl", "app", "3.0.0")
    assert (await publish(client, maint_token, "acl", "app", "3.0.0", archive3, sig3)).status_code == 200

    res = await client.post(
        "/api/v1/namespaces/acl/maintainers",
        headers=auth_header(maint_token),
        json={"username": "owner-acl", "role": "maintainer"},
    )
    assert res.status_code == 403


async def test_suspended_user_cannot_publish(client):
    token, uid = await create_user("suspended-user")
    admin_token, _ = await create_user("admin-susp")
    archive, sig, _, _ = signed_package("acme", "sus", "1.0.0")
    assert (await publish(client, token, "acme", "sus", "1.0.0", archive, sig)).status_code == 200

    res = await client.post(
        f"/api/v1/admin/users/{uid}/suspend", headers=auth_header(admin_token), json={"suspended": True}
    )
    assert res.status_code == 403  # admin_token is not an admin

    async with get_session_factory()() as session:
        admin_user = User(username="admin-real", role="admin", created_at=utcnow() - timedelta(days=30))
        session.add(admin_user)
        await session.commit()
        await session.refresh(admin_user)
        admin_uid = admin_user.id
    real_admin_token = issue_token(admin_uid, "admin-real")

    res = await client.post(
        f"/api/v1/admin/users/{uid}/suspend", headers=auth_header(real_admin_token), json={"suspended": True}
    )
    assert res.status_code == 200

    archive2, sig2, _, _ = signed_package("acme", "sus", "2.0.0")
    res = await publish(client, token, "acme", "sus", "2.0.0", archive2, sig2)
    assert res.status_code == 403
    assert "suspended" in res.text


async def test_yank_requires_reviewer_or_admin(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "yank", "1.0.0")
    assert (await publish(client, token, "acme", "yank", "1.0.0", archive, sig)).status_code == 200
    res = await client.post(
        "/api/v1/admin/agents/acme/yank/versions/1.0.0/yank", headers=auth_header(token), json={"yanked": True}
    )
    assert res.status_code == 403

    from app.db import get_session_factory as gsf

    async with gsf()() as session:
        reviewer = User(username="reviewer-real", role="reviewer", created_at=utcnow() - timedelta(days=30))
        session.add(reviewer)
        await session.commit()
        await session.refresh(reviewer)
        reviewer_uid = reviewer.id
    reviewer_token = issue_token(reviewer_uid, "reviewer-real")
    res = await client.post(
        "/api/v1/admin/agents/acme/yank/versions/1.0.0/yank",
        headers=auth_header(reviewer_token),
        json={"yanked": True},
    )
    assert res.status_code == 200
    detail = (await client.get("/api/v1/agents/acme/yank/versions/1.0.0")).json()
    assert detail["yanked"] is True


async def test_new_account_publish_quota(client):
    async with get_session_factory()() as session:
        fresh = User(username="fresh-user", created_at=utcnow())
        session.add(fresh)
        await session.commit()
        await session.refresh(fresh)
        fresh_uid = fresh.id
    token = issue_token(fresh_uid, "fresh-user")

    for i in range(10):
        archive, sig, _, _ = signed_package("quota", f"a{i}", "1.0.0")
        res = await publish(client, token, "quota", f"a{i}", "1.0.0", archive, sig)
        assert res.status_code == 200, res.text
    archive, sig, _, _ = signed_package("quota", "a10", "1.0.0")
    res = await publish(client, token, "quota", "a10", "1.0.0", archive, sig)
    assert res.status_code == 429


async def test_manifest_schema_invalid_permissions_rejected(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/schemab"
    manifest = hello_manifest(full, "1.0.0", permissions=["none", "network"])
    files = {"agent.yaml": yaml.safe_dump(manifest), "app.py": "print(1)\n"}
    archive, sig = make_archive(full, "1.0.0", manifest, files, key, pub)
    res = await publish(client, token, "acme", "schemab", "1.0.0", archive, sig)
    assert res.status_code == 422


async def test_manifest_schema_object_permissions_rejected(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/schemac"
    manifest = hello_manifest(full, "1.0.0", permissions={"network": True})
    files = {"agent.yaml": yaml.safe_dump(manifest), "app.py": "print(1)\n"}
    archive, sig = make_archive(full, "1.0.0", manifest, files, key, pub)
    res = await publish(client, token, "acme", "schemac", "1.0.0", archive, sig)
    assert res.status_code == 422


async def test_duplicate_or_nested_manifest_flagged(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/dupe"
    manifest = hello_manifest(full, "1.0.0")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path in ("agent.yaml", "nested/agent.yaml"):
            data = yaml.safe_dump(manifest).encode()
            info = tarfile.TarInfo(path)
            info.size = len(data)
            info.mode = 0o644
            tf.addfile(info, io.BytesIO(data))
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
        "signature": base64.b64encode(key.sign(f"openagenthub-signature-v1:{full}@1.0.0:{sha}".encode())).decode(),
    }
    res = await publish(client, token, "acme", "dupe", "1.0.0", archive, sig)
    assert res.status_code == 422
    assert "agent.yaml" in res.text


async def test_agent_yml_alias_rejected(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/yml"
    manifest = hello_manifest(full, "1.0.0")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        data = yaml.safe_dump(manifest).encode()
        info = tarfile.TarInfo("agent.yml")
        info.size = len(data)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(data))
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
        "signature": base64.b64encode(key.sign(f"openagenthub-signature-v1:{full}@1.0.0:{sha}".encode())).decode(),
    }
    res = await publish(client, token, "acme", "yml", "1.0.0", archive, sig)
    assert res.status_code == 422


async def test_entry_count_limit_flagged(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/entries"
    manifest = hello_manifest(full, "1.0.0")
    manifest_bytes = yaml.safe_dump(manifest).encode()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path in ("agent.yaml", *[f"f{i}.txt" for i in range(10005)]):
            data = manifest_bytes if path == "agent.yaml" else b"x"
            info = tarfile.TarInfo(path)
            info.size = len(data)
            info.mode = 0o644
            tf.addfile(info, io.BytesIO(data))
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
        "signature": base64.b64encode(key.sign(f"openagenthub-signature-v1:{full}@1.0.0:{sha}".encode())).decode(),
    }
    res = await publish(client, token, "acme", "entries", "1.0.0", archive, sig)
    assert res.status_code == 200
    assert res.json()["security"] == "flagged"
    assert any("entries" in f for f in res.json()["findings"])


async def test_scan_requires_auth(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "scan", "1.0.0")
    await publish(client, token, "acme", "scan", "1.0.0", archive, sig)
    res = await client.post("/api/v1/agents/acme/scan/versions/1.0.0/scan")
    assert res.status_code == 401
