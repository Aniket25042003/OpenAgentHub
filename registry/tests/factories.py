import uuid
from datetime import timedelta

from app.db import get_session_factory, utcnow
from app.identity.application import issue_token
from app.identity.models import User
from tests.helpers import hello_manifest, make_archive, make_keypair

ESTABLISHED_ACCOUNT_AGE = timedelta(days=30)


async def create_user(username: str | None = None) -> tuple[str, int]:
    username = username or f"tester-{uuid.uuid4().hex[:8]}"
    async with get_session_factory()() as session:
        user = User(username=username, created_at=utcnow() - ESTABLISHED_ACCOUNT_AGE)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        uid = user.id
    token = issue_token(uid, username)
    return token, uid


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def signed_package(namespace: str, name: str, version: str = "0.1.0", payload: dict | None = None):
    key, priv, pub = make_keypair()
    full_name = f"{namespace}/{name}"
    manifest = hello_manifest(full_name, version)
    files = {"agent.yaml": __import__("yaml").safe_dump(manifest), "app.py": "print('hi')\n"}
    if payload:
        files.update(payload)
    archive, sig = make_archive(full_name, version, manifest, files, key, pub)
    return archive, sig, manifest, pub


async def upload_key(client, token, public_key_pem: str, **extra) -> dict:
    body = {"publicKey": public_key_pem, **extra}
    res = await client.post("/api/v1/keys", headers=auth_header(token), json=body)
    return res.json()


async def publish(client, token, namespace, name, version, archive, sig):
    await client.post("/api/v1/keys", headers=auth_header(token), json={"publicKey": sig["publicKey"]})
    return await client.put(
        f"/api/v1/agents/{namespace}/{name}/versions/{version}",
        headers=auth_header(token),
        files={
            "archive": (f"{name}-{version}.ahb", archive, "application/octet-stream"),
            "signature": ("signature.sig.json", __import__("json").dumps(sig), "application/json"),
        },
    )
