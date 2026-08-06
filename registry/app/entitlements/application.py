import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repositories import AuditRepository
from app.config import get_settings
from app.identity.models import User


class QuotaExceeded(ValueError):
    def __init__(self, message: str, retry_after: int = 3600) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _account_age_days(user: User) -> int:
    created = user.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - created).days)


async def check_publish_quota(session: AsyncSession, user: User) -> None:
    """New accounts are limited to a daily publish count, enforced via the audit trail."""
    settings = get_settings()
    if _account_age_days(user) >= settings.publish_quota_new_account_days:
        return
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    count = await AuditRepository(session).count_by_action(
        actor_id=user.id, action="version.published", since=since
    )
    if count >= settings.publish_quota_new_account_daily:
        raise QuotaExceeded("new-account daily publish limit reached")


class SlidingWindowRateLimiter:
    def __init__(self, max_events: int, window_seconds: int) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> int | None:
        """Record an event for key. Returns seconds until allowed again if over limit, else None."""
        now = time.monotonic()
        queue = self._events[key]
        while queue and queue[0] <= now - self.window_seconds:
            queue.popleft()
        if len(queue) >= self.max_events:
            return max(1, int(queue[0] + self.window_seconds - now))
        queue.append(now)
        return None

    def reset(self) -> None:
        self._events.clear()


def check_publish_rate(ip: str) -> None:
    """Publish writes are rate-limited per source IP via the shared limiter.

    Delegating to the app-level rate limiter keeps publish counters on the same
    shared backend as every other limit (multi-instance deployments see one
    global counter rather than one per process).
    """
    from app.ratelimit import RateLimitExceeded, get_rate_limiter
    from app.config import get_settings

    settings = get_settings()
    retry = get_rate_limiter().check(f"pub:{ip}", settings.publish_per_ip_per_hour, 3600)
    if retry is not None:
        raise QuotaExceeded("publish rate limit reached for this address", retry_after=retry)


def reset_publish_limits() -> None:
    from app.ratelimit import reset_rate_limiter

    reset_rate_limiter()
