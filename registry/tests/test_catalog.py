import json

from tests.factories import create_user, publish, signed_package


async def _seed(client, token, agents):
    for namespace, name, version in agents:
        archive, sig, _, _ = signed_package(namespace, name, version)
        res = await publish(client, token, namespace, name, version, archive, sig)
        assert res.status_code == 200, res.text


async def test_catalog_lists_latest_visible(client):
    token, _ = await create_user()
    await _seed(client, token, [("acme", "alpha", "1.0.0"), ("acme", "alpha", "1.1.0"), ("acme", "beta", "2.0.0")])

    res = await client.get("/api/v1/catalog")
    assert res.status_code == 200
    body = res.json()
    assert body["schemaVersion"] == 1
    assert body["watermark"]
    assert body["nextCursor"] is None
    items = body["items"]
    assert len(items) == 2
    by_name = {i["name"]: i for i in items}
    assert by_name["alpha"]["version"] == "1.1.0"
    assert by_name["beta"]["version"] == "2.0.0"
    assert by_name["alpha"]["runtime"] == "python"
    assert "etag" in res.headers or "ETag" in res.headers


async def test_catalog_etag_304(client):
    token, _ = await create_user()
    await _seed(client, token, [("acme", "gamma", "1.0.0")])
    res = await client.get("/api/v1/catalog")
    etag = res.headers.get("etag") or res.headers.get("ETag")
    assert etag
    res2 = await client.get("/api/v1/catalog", headers={"If-None-Match": etag})
    assert res2.status_code == 304


async def test_catalog_filters(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "netty", "1.0.0")
    manifest = json.loads((await publish(client, token, "acme", "netty", "1.0.0", archive, sig)).text)
    assert manifest["ok"]

    res = await client.get("/api/v1/catalog", params={"permission": "network"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1 and items[0]["name"] == "netty"

    res = await client.get("/api/v1/catalog", params={"permission": "none"})
    assert res.json()["items"] == []

    res = await client.get("/api/v1/catalog", params={"runtime": "python"})
    assert len(res.json()["items"]) == 1

    res = await client.get("/api/v1/catalog", params={"runtime": "ruby"})
    assert res.json()["items"] == []

    res = await client.get("/api/v1/catalog", params={"publisher_status": "verified"})
    items = res.json()["items"]
    assert len(items) == 1 and items[0]["signerVerified"] is True

    res = await client.get("/api/v1/catalog", params={"publisher_status": "unverified"})
    assert res.json()["items"] == []


async def test_catalog_pagination(client):
    token, _ = await create_user()
    agents = [("acme", f"pkg-{i:02d}", "1.0.0") for i in range(5)]
    await _seed(client, token, agents)

    res = await client.get("/api/v1/catalog", params={"limit": 2})
    body = res.json()
    assert len(body["items"]) == 2
    assert body["nextCursor"] is not None

    res2 = await client.get("/api/v1/catalog", params={"limit": 2, "cursor": body["nextCursor"]})
    body2 = res2.json()
    assert len(body2["items"]) == 2
    seen = {i["name"] for i in body["items"]} | {i["name"] for i in body2["items"]}
    assert len(seen) == 4

    res3 = await client.get("/api/v1/catalog", params={"limit": 2, "cursor": body2["nextCursor"]})
    body3 = res3.json()
    assert len(body3["items"]) == 1
    assert body3["nextCursor"] is None
    assert all(i["name"] not in seen for i in body3["items"])


async def test_catalog_invalid_cursor(client):
    res = await client.get("/api/v1/catalog", params={"cursor": "not-a-cursor"})
    assert res.status_code == 400


async def test_catalog_cache_headers(client):
    token, _ = await create_user()
    await _seed(client, token, [("acme", "cached", "1.0.0")])
    res = await client.get("/api/v1/catalog")
    assert res.status_code == 200
    assert res.headers.get("cache-control")
