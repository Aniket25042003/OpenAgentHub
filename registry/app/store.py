import asyncio
from pathlib import Path

from app.config import get_settings


class ArchiveStoreError(ValueError):
    pass


def _safe_segment(value: str, field: str) -> None:
    if not value or value in (".", "..") or "/" in value or "\\" in value or "\x00" in value:
        raise ArchiveStoreError(f"invalid {field}: {value!r}")


class ArchiveStore:
    """Filesystem-backed store for package archives (MinIO/S3 adapter can be swapped in)."""

    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root or get_settings().storage_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, namespace: str, name: str, version: str) -> Path:
        for field, value in (("namespace", namespace), ("name", name), ("version", version)):
            _safe_segment(value, field)
        p = self.root / namespace / name / f"{version}.ahb"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    async def put(self, namespace: str, name: str, version: str, data: bytes) -> None:
        path = self._path(namespace, name, version)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, path.write_bytes, data)

    async def get(self, namespace: str, name: str, version: str) -> bytes | None:
        path = self._path(namespace, name, version)
        if not path.exists():
            return None
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, path.read_bytes)

    async def size(self, namespace: str, name: str, version: str) -> int | None:
        path = self._path(namespace, name, version)
        if not path.exists():
            return None
        loop = asyncio.get_running_loop()
        stat = await loop.run_in_executor(None, path.stat)
        return stat.st_size

    async def delete(self, namespace: str, name: str, version: str) -> None:
        path = self._path(namespace, name, version)
        if path.exists():
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, path.unlink)
