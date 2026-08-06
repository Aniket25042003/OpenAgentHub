from fastapi import Request

from app.ratelimit import (
    MemoryRateLimitBackend,
    RateLimitRule,
    SlidingWindowRateLimiter,
    enforce,
    get_rate_limiter,
    reset_rate_limiter,
    trusted_client_ip,
)

from tests.factories import create_user, publish, signed_package


def _fake_request(peer: str, headers: dict | None = None) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": ("127.0.0.1", 1234) if peer == "auto" else (peer, 1234),
    }
    return Request(scope)


async def test_memory_backend_sliding_window():
    backend = MemoryRateLimitBackend()
    limiter = SlidingWindowRateLimiter(backend)
    assert limiter.check("k", 3, 60) is None
    assert limiter.check("k", 3, 60) is None
    assert limiter.check("k", 3, 60) is None
    assert limiter.check("k", 3, 60) is not None


async def test_enforce_raises_after_ip_limit():
    reset_rate_limiter()
    rule = RateLimitRule(2, 60)
    request = _fake_request("1.2.3.4")
    enforce(request, ip_rule=rule)
    enforce(request, ip_rule=rule)
    from app.ratelimit import RateLimitExceeded

    try:
        enforce(request, ip_rule=rule)
        raise AssertionError("expected RateLimitExceeded")
    except RateLimitExceeded as exc:
        assert exc.limit == 2
        assert exc.retry_after >= 1


async def test_enforce_raises_after_account_limit():
    reset_rate_limiter()
    rule = RateLimitRule(1, 60)
    request = _fake_request("9.9.9.9")
    enforce(request, account_rule=rule, account_key="42")
    from app.ratelimit import RateLimitExceeded

    try:
        enforce(request, account_rule=rule, account_key="42")
        raise AssertionError("expected RateLimitExceeded")
    except RateLimitExceeded:
        pass


async def test_forwarded_header_ignored_without_trusted_proxy():
    request = _fake_request("1.2.3.4", {"X-Forwarded-For": "6.6.6.6"})
    assert trusted_client_ip(request, {"10.0.0.1"}) == "1.2.3.4"

    reset_rate_limiter()
    rule = RateLimitRule(1, 60)
    enforce(request, ip_rule=rule)
    from app.ratelimit import RateLimitExceeded

    try:
        enforce(request, ip_rule=rule)
        raise AssertionError("expected RateLimitExceeded")
    except RateLimitExceeded:
        pass


async def test_forwarded_header_used_when_peer_is_trusted_proxy():
    request = _fake_request("10.0.0.1", {"X-Forwarded-For": "6.6.6.6"})
    assert trusted_client_ip(request, {"10.0.0.1"}) == "6.6.6.6"


async def test_anonymous_reads_get_429(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "anonymous_reads_per_minute", 2)
    for _ in range(2):
        res = await client.get("/api/v1/agents")
        assert res.status_code == 200
    res = await client.get("/api/v1/agents")
    assert res.status_code == 429
    assert res.headers["retry-after"]
    assert res.headers["x-ratelimit-limit"] == "2"


async def test_downloads_limited_per_ip(client, monkeypatch):
    from app.config import get_settings

    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "hot", "1.0.0")
    await publish(client, token, "acme", "hot", "1.0.0", archive, sig)

    monkeypatch.setattr(get_settings(), "downloads_per_minute_by_ip", 1)
    res = await client.get("/api/v1/agents/acme/hot/versions/1.0.0/archive")
    assert res.status_code == 200
    res = await client.get("/api/v1/agents/acme/hot/versions/1.0.0/archive")
    assert res.status_code == 429


async def test_downloads_own_bucket_unaffected_by_anonymous_reads(client, monkeypatch):
    """Downloads must not share the anonymous-read limiter bucket.

    A client doing many reads should not burn the download budget (and vice
    versa); the fix separates them via the ``bucket`` key namespace.
    """
    from app.config import get_settings

    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "hot", "1.0.0")
    await publish(client, token, "acme", "hot", "1.0.0", archive, sig)

    monkeypatch.setattr(get_settings(), "downloads_per_minute_by_ip", 1)
    monkeypatch.setattr(get_settings(), "anonymous_reads_per_minute", 300)

    for _ in range(20):
        res = await client.get("/api/v1/agents/acme/hot")
        assert res.status_code == 200
    res = await client.get("/api/v1/agents/acme/hot/versions/1.0.0/archive")
    assert res.status_code == 200


async def test_publish_invalidation_reaches_catalog(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "v1", "1.0.0")
    await publish(client, token, "acme", "v1", "1.0.0", archive, sig)

    res = await client.get("/api/v1/catalog")
    assert res.status_code == 200
    etag = res.headers["etag"] or res.headers["ETag"]
    assert len(res.json()["items"]) == 1

    res = await client.get("/api/v1/catalog", headers={"If-None-Match": etag})
    assert res.status_code == 304

    archive2, sig2, _, _ = signed_package("acme", "v2", "1.0.0")
    await publish(client, token, "acme", "v2", "1.0.0", archive2, sig2)

    res = await client.get("/api/v1/catalog", headers={"If-None-Match": etag})
    assert res.status_code == 200
    assert len(res.json()["items"]) == 2
