"""M-8.9 Storage, download, and member quotas."""

import uuid

from tests.factories import auth_header, create_user, signed_package, upload_key


async def _make_org(client, owner_token, slug=None):
    slug = slug or f"quota-{uuid.uuid4().hex[:6]}"
    res = await client.post(
        "/api/v1/orgs", headers=auth_header(owner_token), json={"slug": slug, "displayName": slug.title()}
    )
    assert res.status_code == 201, res.text
    return slug


async def _set_quota(client, owner_token, org, limits, ttl_days=30):
    return await client.put(
        f"/api/v1/orgs/{org}/quota",
        headers=auth_header(owner_token),
        json={"limits": limits, "ttlDays": ttl_days},
    )


async def test_quota_snapshot_defaults(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/quota", headers=auth_header(owner_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["limits"]["packages"] > 0
    assert "usage" in body and "members" in body["usage"]
    assert body["resetDate"].startswith("20")
    assert body["overridesExpireAt"] is None


async def test_quota_requires_membership(client):
    outsider_token, _ = await create_user()
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/quota", headers=auth_header(outsider_token))
    assert res.status_code == 403


async def test_quota_override_and_effective_limits(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await _set_quota(client, owner_token, org, {"packages": 2, "versions": 4})
    assert res.status_code == 200, res.text
    assert res.json()["limits"]["packages"] == 2
    assert res.json()["limits"]["versions"] == 4
    assert res.json()["overridesExpireAt"] is not None
    # defaults remain for untouched dimensions
    assert res.json()["limits"]["members"] > 0


async def test_quota_override_requires_owner_or_admin(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    member_user = f"member-{uuid.uuid4().hex[:6]}"
    member_token, member_uid = await create_user(member_user)
    org = await _make_org(client, owner_token)
    res = await client.post(
        f"/api/v1/orgs/{org}/members",
        headers=auth_header(owner_token),
        json={"username": member_user, "role": "read_only"},
    )
    assert res.status_code == 201, res.text
    res = await client.put(
        f"/api/v1/orgs/{org}/quota",
        headers=auth_header(member_token),
        json={"limits": {"packages": 1}, "ttlDays": 30},
    )
    assert res.status_code == 403


async def test_quota_rejects_unknown_dimension(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await _set_quota(client, owner_token, org, {"bogus": 1})
    assert res.status_code == 400


async def test_publish_enforces_version_quota(client):
    from tests.helpers import hello_manifest, make_archive, make_keypair

    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    await _set_quota(client, owner_token, org, {"versions": 1})
    key, priv, pub = make_keypair()
    manifest = hello_manifest(f"{org}/tool", "0.1.0")
    archive, sig = make_archive(
        f"{org}/tool", "0.1.0", manifest,
        {"agent.yaml": __import__("yaml").safe_dump(manifest), "app.py": "print('hi')\n"},
        key, pub,
    )
    await upload_key(client, owner_token, pub)
    res = await client.put(
        f"/api/v1/agents/{org}/tool/versions/0.1.0",
        headers=auth_header(owner_token),
        files={
            "archive": ("tool-0.1.0.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig), "application/json"),
        },
    )
    # before the package is org-bound the org quota does not apply
    assert res.status_code == 200, res.text
    # bind it, then publish a second version which should be blocked
    res = await client.patch(
        f"/api/v1/agents/{org}/tool/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "internal", "organizationSlug": org},
    )
    assert res.status_code == 200, res.text
    manifest2 = hello_manifest(f"{org}/tool", "0.2.0")
    archive2, sig2 = make_archive(
        f"{org}/tool", "0.2.0", manifest2,
        {"agent.yaml": __import__("yaml").safe_dump(manifest2), "app.py": "print('hi2')\n"},
        key, pub,
    )
    res = await client.put(
        f"/api/v1/agents/{org}/tool/versions/0.2.0",
        headers=auth_header(owner_token),
        files={
            "archive": ("tool-0.2.0.ahb", archive2, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig2), "application/json"),
        },
    )
    assert res.status_code == 429, res.text
    assert "quota" in res.text.lower()


async def test_download_quota_blocks_overage(client):
    from app.registry.downloads import get_download_buffer

    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    archive, sig, _, pub = signed_package(org, "dl")
    await upload_key(client, owner_token, pub)
    res = await client.put(
        f"/api/v1/agents/{org}/dl/versions/0.1.0",
        headers=auth_header(owner_token),
        files={
            "archive": ("dl-0.1.0.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig), "application/json"),
        },
    )
    assert res.status_code == 200, res.text
    res = await client.patch(
        f"/api/v1/agents/{org}/dl/visibility",
        headers=auth_header(owner_token),
        json={"visibility": "internal", "organizationSlug": org},
    )
    assert res.status_code == 200, res.text

    size = len(archive)
    res = await _set_quota(client, owner_token, org, {"downloadBytesPerMonth": size - 1})
    assert res.status_code == 200, res.text

    await get_download_buffer().flush()
    res = await client.get(
        f"/api/v1/agents/{org}/dl/versions/0.1.0/archive", headers=auth_header(owner_token)
    )
    assert res.status_code == 429, res.text
    assert "quota" in res.text.lower()


async def test_member_quota_enforced_on_add(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    await _set_quota(client, owner_token, org, {"members": 1})
    res = await client.post(
        f"/api/v1/orgs/{org}/members",
        headers=auth_header(owner_token),
        json={"username": f"quota-member-{uuid.uuid4().hex[:6]}", "role": "read_only"},
    )
    assert res.status_code == 400
    assert "quota" in res.text.lower()


async def test_admin_override_is_audited(client):
    from app.db import get_session_factory

    owner_token, uid = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await _set_quota(client, owner_token, org, {"packages": 30}, ttl_days=7)
    assert res.status_code == 200

    await client.get(f"/api/v1/orgs/{org}/audit-log", headers=auth_header(owner_token))
    async with get_session_factory()() as session:
        from app.audit.repositories import AuditRepository

        events = await AuditRepository(session).search(action="organization.quota.override_set")
    assert len(events) == 1
    assert events[0].organization_id is not None
    assert events[0].detail["overrides"]["packages"] == 30


async def test_quota_member_count_tracks_real_members(client):
    owner_token, _ = await create_user(f"quota-owner-{uuid.uuid4().hex[:6]}")
    org = await _make_org(client, owner_token)
    res = await client.get(f"/api/v1/orgs/{org}/quota", headers=auth_header(owner_token))
    assert res.json()["usage"]["members"] >= 1