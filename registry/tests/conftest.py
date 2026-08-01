import json
import os
import tempfile

import httpx
import pytest
from asgi_lifespan import LifespanManager

_TEST_DB = os.path.join(tempfile.mkdtemp(prefix="oah-reg-test-"), "test.db")
os.environ.setdefault("REGISTRY_DATABASE_URL", f"sqlite+aiosqlite:///{_TEST_DB}")
os.environ.setdefault("REGISTRY_STORAGE_DIR", tempfile.mkdtemp(prefix="oah-reg-storage-"))
os.environ.setdefault("REGISTRY_JWT_SECRET", "test-secret-0123456789abcdef0123456789abcdef")

from app.main import create_app  # noqa: E402


@pytest.fixture
async def client():
    app = create_app()
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
