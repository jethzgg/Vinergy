"""Demo-session guard: who is calling, and is the CSRF token right (api_contracts §3, Reservation_Design §4.1).

Only the *reading* side lives here (2.2.1 needs an authenticated user). Creating and
revoking sessions (`POST/GET/DELETE /api/v1/demo-session`) belongs to 2.2.3 (M2) and
should reuse `session_token_hash` and `csrf_token_for` so both sides agree.

Cookie `vinergy_sid` carries `raw_sid`: 32 random bytes, base64url without padding.
- `user_session.session_token_hash` = hex HMAC-SHA256(SESSION_SECRET, raw_sid)
- `csrf_token` = base64url(HMAC-SHA256(SESSION_SECRET, "csrf:" + raw_sid))
Both HMACs are computed over the cookie text exactly as sent. Never log either value.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime

from app.errors import ApiError

SESSION_COOKIE = "vinergy_sid"
CSRF_HEADER = "X-CSRF-Token"


def new_raw_sid() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def session_token_hash(secret: str, raw_sid: str) -> str:
    return hmac.new(secret.encode("utf-8"), raw_sid.encode("utf-8"), hashlib.sha256).hexdigest()


def csrf_token_for(secret: str, raw_sid: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), ("csrf:" + raw_sid).encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def session_required() -> ApiError:
    return ApiError(401, "SESSION_REQUIRED", "Vui lòng chọn người dùng demo để tiếp tục.")


def resolve_user(conn, secret: str, raw_sid: str | None, now: datetime) -> str:
    """Return the user_id bound to the cookie, or raise 401 (§3, AE-23f).

    Unknown and revoked sessions look the same to the caller (SESSION_REQUIRED);
    only a session past its absolute expiry reports SESSION_EXPIRED.
    """
    if not raw_sid:
        raise session_required()
    row = conn.execute(
        "SELECT user_id, expires_at, revoked_at FROM user_session WHERE session_token_hash = %s",
        (session_token_hash(secret, raw_sid),),
    ).fetchone()
    if row is None or row[2] is not None:
        raise session_required()
    if now >= row[1]:
        raise ApiError(401, "SESSION_EXPIRED", "Phiên demo đã hết hạn. Vui lòng chọn lại người dùng demo.")
    return row[0]


def require_csrf(secret: str, raw_sid: str, token: str | None) -> None:
    """403 CSRF_INVALID unless X-CSRF-Token matches the token derived from this session."""
    expected = csrf_token_for(secret, raw_sid)
    if not token or not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        raise ApiError(403, "CSRF_INVALID", "Thiếu hoặc sai mã chống giả mạo yêu cầu (X-CSRF-Token).")
