"""Latest-version resolution and version-list ordering are semver-based,
not publication-order-based."""

from tests.factories import auth_header, create_user, publish, signed_package


async def test_latest_is_highest_semver_not_most_recently_published(client):
    token, _ = await create_user("publisher")
    for version in ("1.9.0", "1.10.0", "0.5.0"):
        archive, sig, _, _ = signed_package("acme", "ver", version)
        res = await publish(client, token, "acme", "ver", version, archive, sig)
        assert res.status_code == 200, res.text

    res = await client.get("/api/v1/agents/acme/ver")
    assert res.status_code == 200
    assert res.json()["version"] == "1.10.0"

    res = await client.get("/api/v1/agents/acme/ver/versions")
    assert res.json()["versions"] == ["1.10.0", "1.9.0", "0.5.0"]

    detail = await client.get("/api/v1/agents/acme/ver/versions/latest")
    assert detail.status_code == 200
    assert detail.json()["manifest"]["version"] == "1.10.0"


async def test_republishing_old_version_does_not_change_latest(client):
    token, _ = await create_user("publisher")
    for version in ("2.0.0", "2.0.1"):
        archive, sig, _, _ = signed_package("acme", "ver", version)
        res = await publish(client, token, "acme", "ver", version, archive, sig)
        assert res.status_code == 200, res.text

    archive, sig, _, _ = signed_package("acme", "ver", "1.0.0")
    res = await publish(client, token, "acme", "ver", "1.0.0", archive, sig)
    assert res.status_code == 200, res.text

    res = await client.get("/api/v1/agents/acme/ver")
    assert res.json()["version"] == "2.0.1"


async def test_prerelease_sorts_below_release(client):
    token, _ = await create_user("publisher")
    for version in ("3.0.0", "3.0.0-beta.2"):
        archive, sig, _, _ = signed_package("acme", "ver", version)
        res = await publish(client, token, "acme", "ver", version, archive, sig)
        assert res.status_code == 200, res.text

    res = await client.get("/api/v1/agents/acme/ver")
    assert res.json()["version"] == "3.0.0"
    res = await client.get("/api/v1/agents/acme/ver/versions")
    assert res.json()["versions"] == ["3.0.0", "3.0.0-beta.2"]
