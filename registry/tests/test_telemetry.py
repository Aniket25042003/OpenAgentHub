async def test_ready_reports_dependencies(client):
    res = await client.get("/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["storage"] == "ok"


async def test_metrics_endpoint(client):
    await client.get("/health")
    res = await client.get("/metrics")
    assert res.status_code == 200
    assert "text/plain" in res.headers["content-type"]
    assert 'http_requests_total{method="GET",path="/health",status="200"} 1' in res.text


async def test_request_id_is_echoed(client):
    res = await client.get("/health", headers={"X-Request-Id": "abc123"})
    assert res.headers["x-request-id"] == "abc123"
    res = await client.get("/health")
    assert len(res.headers["x-request-id"]) == 16


async def test_openapi_contains_request_id_operation(client):
    res = await client.get("/openapi.json")
    assert res.status_code == 200
    paths = res.json()["paths"]
    assert "/health" in paths
    assert "/ready" in paths
    assert "/metrics" in paths
