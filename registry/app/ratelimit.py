"""Sliding-window rate limiting with a pluggable shared backend.

Limits are enforced per configured key (account and/or IP). The backend can be
shared across instances in production (Redis) so the counters are global rather
than per-process; in-process memory is used for dev and single-instance
deployments. Client IP resolution only trusts ``X-Forwarded-For`` when the
direct peer is itself a configured trusted proxy; arbitrary forwarding headers
can never bypass limits.
"""

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Protocol

from fastapi import Request


@dataclass(frozen=True)
class RateLimitRule:
    limit: int
    window_seconds: int


class RateLimitExceeded(Exception):
    def __init__(self, *, limit: int, window_seconds: int, retry_after: int) -> None:
        super().__init__(f"rate limit exceeded (max {limit} per {window_seconds}s)")
        self.limit = limit
        self.window_seconds = window_seconds
        self.retry_after = retry_after


def enforce(
    request: Request,
    *,
    ip_rule: RateLimitRule | None = None,
    account_rule: RateLimitRule | None = None,
    account_key: str | None = None,
) -> bool:
    """Enforce zero or more limits and return whether at least one was applied."""
    from app.config import get_settings

    limiter = get_rate_limiter()
    applied = False
    ip = None
    if ip_rule is not None:
        settings = get_settings()
        ip = trusted_client_ip(request, settings.trusted_proxy_set)
        retry = limiter.check(f"ip:{ip}", ip_rule.limit, ip_rule.window_seconds)
        applied = True
        if retry is not None:
            raise RateLimitExceeded(limit=ip_rule.limit, window_seconds=ip_rule.window_seconds, retry_after=retry)
    if account_rule is not None and account_key:
        retry = limiter.check(f"acct:{account_key}", account_rule.limit, account_rule.window_seconds)
        applied = True
        if retry is not None:
            raise RateLimitExceeded(limit=account_rule.limit, window_seconds=account_rule.window_seconds, retry_after=retry)
    return applied


class RateLimitBackend(Protocol):
    """Counter store shared by (potentially) multiple app instances."""

    def events_in_window(self, key: str, window_seconds: int) -> int: ...

    def record(self, key: str, window_seconds: int) -> None: ...

    def retry_after(self, key: str, window_seconds: int) -> int: ...

    def reset(self) -> None: ...


class MemoryRateLimitBackend:
    """In-process sliding-window backend (dev / single-instance)."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, window_seconds: int) -> None:
        now = time.monotonic()
        queue = self._events[key]
        while queue and queue[0] <= now - window_seconds:
            queue.popleft()

    def events_in_window(self, key: str, window_seconds: int) -> int:
        self._prune(key, window_seconds)
        return len(self._events[key])

    def record(self, key: str, window_seconds: int) -> None:
        self._events[key].append(time.monotonic())

    def retry_after(self, key: str, window_seconds: int) -> int:
        self._prune(key, window_seconds)
        queue = self._events[key]
        if not queue:
            return 0
        now = time.monotonic()
        return max(1, int(window_seconds - (now - queue[0])) + 1)

    def reset(self) -> None:
        self._events.clear()


class RedisRateLimitBackend:
    """Shared sliding-window backend for multi-instance deployments (requires python-redis).

    Events are stored in a ZSET keyed by ``(key, window)`` with wall-clock
    timestamps as scores, mirroring the memory backend's window semantics.
    """

    def __init__(self, client) -> None:
        self._redis = client

    def events_in_window(self, key: str, window_seconds: int) -> int:
        cutoff = time.time() - window_seconds
        self._redis.zremrangebyscore(key, "-inf", cutoff)
        return int(self._redis.zcard(key))

    def record(self, key: str, window_seconds: int) -> None:
        self._redis.zadd(key, {time.time_ns(): time.time()})
        self._redis.expire(key, window_seconds * 2)

    def retry_after(self, key: str, window_seconds: int) -> int:
        cutoff = time.time() - window_seconds
        self._redis.zremrangebyscore(key, "-inf", cutoff)
        oldest = self._redis.zrange(key, 0, 0, withscores=True)
        if not oldest:
            return 0
        return max(1, int(window_seconds - (time.time() - oldest[0][1])) + 1)

    def reset(self) -> None:
        raise RuntimeError("reset not supported against a shared backing store")


class SlidingWindowRateLimiter:
    def __init__(self, backend: RateLimitBackend) -> None:
        self.backend = backend

    def _backend_key(self, key: str, window_seconds: int) -> str:
        return f"{key}:{window_seconds}"

    def check(self, key: str, limit: int, window_seconds: int) -> int | None:
        """Record one event for ``key``; if over ``limit`` return seconds until allowed."""
        bkey = self._backend_key(key, window_seconds)
        if self.backend.events_in_window(bkey, window_seconds) >= limit:
            return max(1, self.backend.retry_after(bkey, window_seconds))
        self.backend.record(bkey, window_seconds)
        return None

    def reset(self) -> None:
        self.backend.reset()


def trusted_client_ip(request: Request, trusted_proxies: set[str]) -> str:
    peer = request.client.host if request.client is not None else ""
    if peer in trusted_proxies:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return peer


def build_backend() -> RateLimitBackend:
    from app.config import get_settings

    settings = get_settings()
    if settings.rate_limit_store == "redis":
        import redis  # type: ignore[import-not-found]

        return RedisRateLimitBackend(redis.Redis.from_url(settings.redis_url))
    return MemoryRateLimitBackend()


_limiter: SlidingWindowRateLimiter | None = None


def get_rate_limiter() -> SlidingWindowRateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = SlidingWindowRateLimiter(build_backend())
    return _limiter


def reset_rate_limiter() -> None:
    get_rate_limiter().reset()