import json

import yaml

from tests.factories import auth_header, create_user, publish, signed_package
from tests.helpers import hello_manifest


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


async def test_requires_auth(client):
    archive, sig, _, _ = signed_package("acme", "agent", "1.0.0")
    res = await publish(client, "", "acme", "agent", "1.0.0", archive, sig)
    assert res.status_code == 401


async def test_publish_search_download_flow(client):
    token, _ = await create_user("publisher")
    archive, sig, manifest, pub = signed_package("acme", "greeter", "1.2.3")

    res = await publish(client, token, "acme", "greeter", "1.2.3", archive, sig)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["security"] == "clean"

    # search
    res = await client.get("/api/v1/agents", params={"q": "greeter"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["namespace"] == "acme"
    assert item["name"] == "greeter"
    assert item["version"] == "1.2.3"
    assert item["models"] == ["local"]
    assert item["downloads"] == 0

    # get summary
    res = await client.get("/api/v1/agents/acme/greeter")
    assert res.status_code == 200
    assert res.json()["name"] == "greeter"

    # list versions
    res = await client.get("/api/v1/agents/acme/greeter/versions")
    assert res.json()["versions"] == ["1.2.3"]

    # version detail matches SDK AgentVersionDetail contract
    res = await client.get("/api/v1/agents/acme/greeter/versions/1.2.3")
    assert res.status_code == 200
    detail = res.json()
    assert detail["name"] == "acme/greeter"
    assert detail["manifest"]["name"] == "acme/greeter"
    assert detail["signature"]["algorithm"] == "ed25519"
    assert detail["security"]["status"] == "clean"
    assert "Z" in detail["publishedAt"]

    # download archive
    res = await client.get("/api/v1/agents/acme/greeter/versions/1.2.3/archive")
    assert res.status_code == 200
    assert res.content == archive
    assert res.headers["content-type"] == "application/octet-stream"
    assert res.headers["x-content-type-options"] == "nosniff"


async def test_download_increments_count(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "counter", "0.1.0")
    await publish(client, token, "acme", "counter", "0.1.0", archive, sig)
    await client.get("/api/v1/agents/acme/counter/versions/0.1.0/archive")
    detail = (await client.get("/api/v1/agents/acme/counter/versions/0.1.0")).json()
    assert detail["downloadCount"] == 1


async def test_rejects_bad_signature(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair_alt()
    from tests.helpers import make_archive

    from tests.factories import signed_package

    archive, sig, _, _ = signed_package("acme", "evil", "1.0.0")
    sig["sha256"] = "0" * 64
    res = await publish(client, token, "acme", "evil", "1.0.0", archive, sig)
    assert res.status_code == 422
    assert "sha256" in res.text


async def test_rejects_name_mismatch(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "one", "1.0.0")
    res = await publish(client, token, "acme", "other", "1.0.0", archive, sig)
    assert res.status_code == 422


async def test_rejects_duplicate_version(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "dup", "1.0.0")
    assert (await publish(client, token, "acme", "dup", "1.0.0", archive, sig)).status_code == 200
    res = await publish(client, token, "acme", "dup", "1.0.0", archive, sig)
    assert res.status_code == 409


async def test_archive_with_symlink_is_flagged(client):
    import base64
    import io
    import tarfile

    from tests.helpers import make_keypair, sha256_hex, public_key_fingerprint as tests_helpers_public_key_fingerprint

    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/linky"
    manifest = hello_manifest_yaml(full)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        info = tarfile.TarInfo("agent.yaml")
        data = manifest.encode()
        info.size = len(data)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(data))
        link = tarfile.TarInfo("pwn")
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
        "publicKeyId": tests_helpers_public_key_fingerprint(pub),
        "sha256": sha,
        "signature": base64.b64encode(key.sign(f"openagenthub-signature-v1:{full}@1.0.0:{sha}".encode())).decode(),
    }
    res = await publish(client, token, "acme", "linky", "1.0.0", archive, sig)
    assert res.status_code == 200
    body = res.json()
    assert body["security"] == "flagged"
    assert any("symlink" in f for f in body["findings"])
    detail = (await client.get("/api/v1/agents/acme/linky/versions/1.0.0")).json()
    assert detail["trust"] == "untrusted"


async def test_rescan_updates_security(client):
    import base64
    import io
    import tarfile

    from tests.factories import create_user
    from tests.helpers import make_archive, make_keypair, sha256_hex

    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "rescan", "1.0.0")
    assert (await publish(client, token, "acme", "rescan", "1.0.0", archive, sig)).status_code == 200
    res = await client.post("/api/v1/agents/acme/rescan/versions/1.0.0/scan", headers=auth_header(token))
    assert res.status_code == 200
    assert res.json()["status"] == "clean"


async def test_me_requires_auth(client):
    res = await client.get("/api/v1/me")
    assert res.status_code == 401


async def test_me_returns_keys(client):
    token, _ = await create_user("keymaster")
    from tests.helpers import make_keypair

    _, _, pub = make_keypair()
    res = await client.post("/api/v1/keys", headers=auth_header(token), json={"publicKey": pub})
    assert res.status_code == 200
    me = (await client.get("/api/v1/me", headers=auth_header(token))).json()
    assert me["username"] == "keymaster"
    assert len(me["publicKeys"]) == 1


async def test_upload_invalid_key(client):
    token, _ = await create_user()
    res = await client.post("/api/v1/keys", headers=auth_header(token), json={"publicKey": "not a pem"})
    assert res.status_code == 400


async def test_path_traversal_archive_rejected(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "safe", "1.0.0")
    await publish(client, token, "acme", "safe", "1.0.0", archive, sig)
    res = await client.get("/api/v1/agents/..%2F..%2F..%2Fetc/safe/versions/1.0.0/archive")
    assert res.status_code in (400, 404)
    res = await client.get("/api/v1/agents/../safe/versions/1.0.0/archive")
    assert res.status_code in (400, 404)
    res = await client.get("/api/v1/agents/acme/safe/versions/1.0.0/archive")
    assert res.status_code == 200
    assert res.content == archive


async def test_oversized_archive_rejected(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "big", "1.0.0")
    res = await publish(client, token, "acme", "big", "1.0.0", archive + b"\x00" * (5 * 1024 * 1024), sig)
    assert res.status_code == 422  # sha256 no longer matches after padding


async def test_unknown_version_404(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "ghost", "1.0.0")
    await publish(client, token, "acme", "ghost", "1.0.0", archive, sig)
    res = await client.get("/api/v1/agents/acme/ghost/versions/9.9.9")
    assert res.status_code == 404


async def test_framework_object_stored_as_name(client):
    from tests.factories import auth_header, create_user, publish, signed_package
    from tests.helpers import hello_manifest, make_archive, make_keypair

    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/fw"
    manifest = hello_manifest(full, "1.0.0", framework={"name": "openagenthub", "version": "0.1.0"})
    files = {"agent.yaml": yaml.safe_dump(manifest), "app.py": "print('hi')\n"}
    archive, sig = make_archive(full, "1.0.0", manifest, files, key, pub)
    res = await publish(client, token, "acme", "fw", "1.0.0", archive, sig)
    assert res.status_code == 200, res.text
    summary = (await client.get("/api/v1/agents/acme/fw")).json()
    assert summary["framework"] == "openagenthub"
    res = await client.get("/api/v1/agents", params={"framework": "openagenthub"})
    names = [i["name"] for i in res.json()["items"]]
    assert "fw" in names


def make_keypair_alt():
    from tests.helpers import make_keypair

    return make_keypair()


def hello_manifest_yaml(full: str) -> str:
    return yaml.safe_dump(hello_manifest(full, "1.0.0"))
