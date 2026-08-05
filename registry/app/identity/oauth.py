"""Hosted GitHub OAuth with stateless signed state and strict redirect handling.

The GitHub authorization code is exchanged only on the backend; neither the
GitHub client secret nor the provider access token is ever sent to browser
JavaScript or stored in CLI vaults. State tokens are short-lived HMAC-signed
values bound to the redirect URI and (for device login) the pending
transaction, so callbacks can be validated without shared mutable state.
"""

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from app.config import get_settings

SCOPE = "read:user"
STATE_TTL_SECONDS = 600


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def make_state_token(*, redirect_uri: str, device_user_code: str | None = None) -> str:
    settings = get_settings()
    exp = int(time.time()) + STATE_TTL_SECONDS
    nonce = _b64url(hashlib.sha256(f"{settings.jwt_secret}:{time.time()}:{redirect_uri}".encode()).digest()[:12])
    payload = json.dumps(
        {"r": redirect_uri, "n": nonce, "e": exp, "d": device_user_code}, separators=(",", ":")
    ).encode()
    digest = hmac.new(settings.jwt_secret.encode(), payload, hashlib.sha256).digest()
    return _b64url(payload) + "." + _b64url(digest)


def verify_state_token(token: str) -> dict | None:
    settings = get_settings()
    try:
        body, _, sig = token.partition(".")
        if not body or not sig:
            return None
        payload = _b64url_decode(body)
        expected = hmac.new(settings.jwt_secret.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url(expected).encode(), sig.encode()):
            return None
        data = json.loads(payload)
        if int(data["e"]) < int(time.time()):
            return None
        return data
    except Exception:  # noqa: BLE001
        return None


def authorize_url(state_token: str, redirect_uri: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
        "state": state_token,
        "allow_signup": "true",
    }
    return f"{settings.github_authorize_url}?{urlencode(params)}"


def is_allowed_redirect(redirect_uri: str) -> bool:
    settings = get_settings()
    allowed = [u.strip() for u in settings.web_redirect_uris.split(",") if u.strip()]
    return redirect_uri in allowed


def cookie_value(token: str, *, max_age_seconds: int | None = None) -> str:
    settings = get_settings()
    age = max_age_seconds or settings.session_absolute_ttl_seconds
    secure = settings.public_base_url.startswith("https://")
    return (
        f"{settings.session_cookie_name}={token}; Path=/; HttpOnly; "
        f"SameSite=Lax; Max-Age={age}" + ("; Secure" if secure else "")
    )


def session_expiry(ttl_seconds: int | None = None) -> datetime:
    settings = get_settings()
    return datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds or settings.session_absolute_ttl_seconds)