"""In-process catalog cache with single-flight refresh and stale-on-error.

Cache entries are keyed on the request parameters and tagged with the catalog
watermark. A watermark mismatch rebuilds the entry (published/review/yank
transactions bump the watermark, so invalidation is effective once the write
commits). If the database is down, the last-known-good payload is returned and
labelled stale via ``X-Catalog-Stale`` and ``Age`` headers.
"""

import asyncio
import hashlib
import time
from dataclasses import dataclass

from app.registry.catalog import etag_for


@dataclass
class CatalogCacheEntry:
    watermark: str
    payload: dict
    etag: str
    cached_at: float


class CatalogCache:
    def __init__(self, ttl_seconds: int = 30) -> None:
        self._entries: dict[str, CatalogCacheEntry] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self.ttl_seconds = ttl_seconds

    @staticmethod
    def cache_key(params: dict) -> str:
        raw = hashlib.sha256(repr(sorted(params.items())).encode()).hexdigest()
        return raw

    def get(self, key: str, watermark: str) -> CatalogCacheEntry | None:
        entry = self._entries.get(key)
        if entry is None or entry.watermark != watermark:
            return None
        if time.monotonic() - entry.cached_at > self.ttl_seconds:
            return None
        return entry

    def stale(self, key: str) -> CatalogCacheEntry | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        return entry

    def put(self, key: str, watermark: str, payload: dict) -> CatalogCacheEntry:
        entry = CatalogCacheEntry(watermark=watermark, payload=payload, etag=etag_for(payload), cached_at=time.monotonic())
        self._entries[key] = entry
        return entry

    def _lock(self, key: str) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())


_catalog_cache: CatalogCache | None = None


def get_catalog_cache() -> CatalogCache:
    global _catalog_cache
    if _catalog_cache is None:
        from app.config import get_settings

        _catalog_cache = CatalogCache(get_settings().catalog_cache_ttl_seconds)
    return _catalog_cache


def reset_catalog_cache() -> None:
    global _catalog_cache
    _catalog_cache = None