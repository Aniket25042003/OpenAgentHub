"""Short-lived signed download URLs (M-8.6).

Registry issuance produces a local HMAC token bound to the exact immutable
namespace/name/version and archive (version id + sha256 digest), an expiration,
and the GET method, so the URL itself carries single-purpose authorization
within a short lifetime. Issuance is audited; the token never is. Live issuance
does not replace client-side digest and signature verification, which the CLI
still performs after download.
"""

import base64
import hashlib
import hmac
import json
import time

from app.config import get_settings


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes | None:
    if not value:
        return None
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError):
        return None


def _sign(payload: str) -> str:
    return _b64(hmac.new(get_settings().jwt_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest())


def issue_download_token(
    *,
    namespace: str,
    name: str,
    version: str,
    version_id: int,
    digest: str,
    ttl_seconds: int,
) -> str:
    payload = json.dumps(
        {
            "k": "ahb-dl",
            "n": namespace,
            "a": name,
            "v": version,
            "i": version_id,
            "d": digest,
            "e": int(time.time()) + max(1, ttl_seconds),
        },
        separators=(",", ":"),
    )
    return _b64(payload.encode("utf-8")) + "." + _sign(payload)


def verify_download_token(
    token: str, *, namespace: str, name: str, version: str, digest: str | None, version_id: int
) -> tuple[bool, int]:
    """Validate a download token against the expected immutable archive.

    Returns ``(ok, expires_epoch)``; ``ok`` is False for any malformed,
    tampered, expired, digest-mismatched, or cross-package token. Callers must
    treat a False result exactly like a missing/blocked package so existence is
    not disclosed through token errors.
    """
    if "." not in token:
        return False, 0
    body_b64, sig = token.split(".", 1)
    raw = _unb64(body_b64)
    if raw is None:
        return False, 0
    payload = raw.decode("utf-8", errors="replace")
    if not hmac.compare_digest(_sign(payload), sig):
        return False, 0
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        return False, 0
    if data.get("k") != "ahb-dl":
        return False, 0
    if data.get("n") != namespace or data.get("a") != name or data.get("v") != version:
        return False, 0
    if data.get("i") != version_id or data.get("d") != digest:
        return False, 0
    expires = data.get("e")
    if not isinstance(expires, int) or expires <= int(time.time()):
        return False, 0
    return True, expires