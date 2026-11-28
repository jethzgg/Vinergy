"""Strict JSON body / header / path validation for reservation endpoints (api_contracts §1.3, §6.2).

Collects every problem before failing (§1.2). `details` order: path, header, body fields
in the endpoint's table order, then unknown body fields, then unknown query parameters. Numbers must be JSON numbers and
strings JSON strings: nothing is coerced ("1", true, 1.0 are all rejected for quantity).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Optional

from app.errors import ApiError
from app.stations.domain import FAMILY_CODES
from app.stations.validation import STATION_ID_RE

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{16,100}$")

DRAFT_FIELDS = ("family_code", "quantity", "station_id", "nearest")
NEAREST_FIELDS = ("lat", "lng", "radius_km")
CONFIRM_FIELDS = ("draft_id", "station_id", "family_code", "quantity")


class _Issues:
    def __init__(self):
        self.items: list = []

    def add(self, field: str, reason: str, message: str) -> None:
        self.items.append({"field": field, "reason": reason, "message": message})

    def raise_if_any(self) -> None:
        if self.items:
            raise ApiError.invalid_input(self.items)


def _is_number(value) -> bool:
    """A JSON number (not a bool). Integers are exact, so any size counts; floats must be finite."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True  # math.isfinite() would raise OverflowError past ~1.8e308
    return isinstance(value, float) and math.isfinite(value)


def _as_float(value) -> Optional[float]:
    """The value as a finite float, or None (not a number, or an integer too large for a float).

    Matches §1.2 "finite after parsing": the query string 10**400 also parses to inf.
    """
    if not _is_number(value):
        return None
    try:
        result = float(value)
    except OverflowError:
        return None
    return result if math.isfinite(result) else None


def _reject_constant(name: str):
    raise ValueError(f"non-standard JSON constant {name}")


def check_content_type(content_type: Optional[str], has_body: bool) -> None:
    """415 when a body is sent as anything but application/json (§1.3 step 3)."""
    if not has_body and not content_type:
        return
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Nội dung yêu cầu phải là application/json.")


def parse_json_object(raw: bytes) -> dict:
    """Malformed JSON, NaN/Infinity, or a non-object body -> 400 INVALID_INPUT with no details."""
    try:
        data = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "INVALID_INPUT", "Nội dung yêu cầu không phải JSON hợp lệ.") from None
    if not isinstance(data, dict):
        raise ApiError(400, "INVALID_INPUT", "Nội dung yêu cầu phải là một đối tượng JSON.")
    return data


def _check_family(issues: _Issues, body: dict) -> None:
    if "family_code" not in body:
        issues.add("family_code", "REQUIRED", "family_code là bắt buộc.")
    elif not isinstance(body["family_code"], str):
        issues.add("family_code", "INVALID_FORMAT", "family_code phải là chuỗi.")
    elif body["family_code"] not in FAMILY_CODES:
        issues.add("family_code", "NOT_IN_ENUM", f"family_code phải là một trong: {', '.join(FAMILY_CODES)}.")


def _check_quantity(issues: _Issues, body: dict) -> None:
    """BR-05 / AE-08: only the JSON integer 1 is accepted."""
    if "quantity" not in body:
        issues.add("quantity", "REQUIRED", "quantity là bắt buộc.")
        return
    value = body["quantity"]
    if not _is_number(value):
        issues.add("quantity", "NOT_A_NUMBER", "quantity phải là số.")
    elif not (isinstance(value, int) and value == 1):
        issues.add("quantity", "MUST_BE_ONE", "Mỗi đơn chỉ được đặt đúng 1 pin.")


def _check_station_id(issues: _Issues, body: dict, required: bool) -> None:
    if "station_id" not in body:
        if required:
            issues.add("station_id", "REQUIRED", "station_id là bắt buộc.")
        return
    value = body["station_id"]
    if not isinstance(value, str) or not STATION_ID_RE.match(value):
        issues.add("station_id", "INVALID_FORMAT", "station_id phải khớp ^[A-Z0-9-]{1,32}$.")


def _check_nearest(issues: _Issues, value) -> Optional[tuple]:
    if not isinstance(value, dict):
        issues.add("nearest", "INVALID_FORMAT", "nearest phải là đối tượng { lat, lng, radius_km? }.")
        return None
    coords = {}
    for name, low, high in (("lat", -90, 90), ("lng", -180, 180)):
        field = f"nearest.{name}"
        if name not in value:
            issues.add(field, "REQUIRED", f"{field} là bắt buộc.")
            continue
        number = _as_float(value[name])
        if number is None:
            issues.add(field, "NOT_A_NUMBER", f"{field} phải là số hợp lệ.")
        elif not low <= number <= high:
            issues.add(field, "OUT_OF_RANGE", f"{field} phải nằm trong [{low}, {high}].")
        else:
            coords[name] = number + 0.0
    # Only an ABSENT radius_km means "no limit" (§4.3); a present one, null included, must be > 0.
    radius = None
    if "radius_km" in value:
        number = _as_float(value["radius_km"])
        if number is None:
            issues.add("nearest.radius_km", "NOT_A_NUMBER", "nearest.radius_km phải là số hợp lệ.")
        elif number <= 0:
            issues.add("nearest.radius_km", "NOT_POSITIVE", "nearest.radius_km phải lớn hơn 0.")
        else:
            radius = number
    for name in value:
        if name not in NEAREST_FIELDS:
            issues.add(f"nearest.{name}", "UNKNOWN_FIELD", f"Trường nearest.{name} không được hỗ trợ.")
    if len(coords) == 2:
        return coords["lat"], coords["lng"], radius
    return None


def _unknown_fields(issues: _Issues, body: dict, allowed: tuple) -> None:
    for name in body:
        if name not in allowed:
            issues.add(name, "UNKNOWN_FIELD", f"Trường {name} không được hỗ trợ.")


def _unknown_params(issues: _Issues, query_names) -> None:
    """None of the reservation endpoints declares a query parameter (§3.4, §1.2): every one is
    UNKNOWN_PARAM, so `?owner=USER-B` fails before anything is written. Listed last, once each."""
    for name in dict.fromkeys(query_names):
        issues.add(name, "UNKNOWN_PARAM", f"Tham số {name} không được hỗ trợ.")


@dataclass(frozen=True)
class DraftRequest:
    family_code: str
    station_id: Optional[str] = None
    nearest: Optional[tuple] = None  # (lat, lng, radius_km | None)


def parse_draft_request(body: dict, query_names=()) -> DraftRequest:
    """POST /api/v1/reservation-drafts (§6.4): exactly one of station_id / nearest."""
    issues = _Issues()
    _check_family(issues, body)
    _check_quantity(issues, body)
    has_station, has_nearest = "station_id" in body, "nearest" in body
    _check_station_id(issues, body, required=False)
    if not has_station and not has_nearest:
        issues.add("station_id", "ONE_OF_REQUIRED", "Cần đúng một trong hai: station_id hoặc nearest.")
    nearest = None
    if has_nearest:
        if has_station:
            issues.add("nearest", "MUTUALLY_EXCLUSIVE", "Chỉ được gửi một trong hai: station_id hoặc nearest.")
        else:
            nearest = _check_nearest(issues, body["nearest"])
    _unknown_fields(issues, body, DRAFT_FIELDS)
    _unknown_params(issues, query_names)
    issues.raise_if_any()
    return DraftRequest(body["family_code"], body.get("station_id"), nearest)


@dataclass(frozen=True)
class ConfirmRequest:
    idempotency_key: str
    draft_id: str
    station_id: str
    family_code: str
    quantity: int = 1

    def request_hash(self) -> str:
        """SHA-256 of the canonical body (sorted keys, no spaces), Reservation_Design §6.2."""
        canonical = json.dumps(
            {
                "draft_id": self.draft_id,
                "station_id": self.station_id,
                "family_code": self.family_code,
                "quantity": self.quantity,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _check_idempotency_key(issues: _Issues, key: Optional[str]) -> None:
    if key is None or key == "":
        issues.add("Idempotency-Key", "REQUIRED", "Header Idempotency-Key là bắt buộc.")
    elif not IDEMPOTENCY_KEY_RE.match(key):
        issues.add("Idempotency-Key", "INVALID_FORMAT", "Idempotency-Key phải khớp ^[A-Za-z0-9_-]{16,100}$.")


def parse_confirm_request(idempotency_key: Optional[str], body: dict, query_names=()) -> ConfirmRequest:
    """POST /api/v1/reservations (§6.7): header, then the four echoed draft fields."""
    issues = _Issues()
    _check_idempotency_key(issues, idempotency_key)
    if "draft_id" not in body:
        issues.add("draft_id", "REQUIRED", "draft_id là bắt buộc.")
    elif not isinstance(body["draft_id"], str) or not UUID_RE.match(body["draft_id"]):
        issues.add("draft_id", "INVALID_FORMAT", "draft_id phải là UUID chữ thường.")
    _check_station_id(issues, body, required=True)
    _check_family(issues, body)
    _check_quantity(issues, body)
    _unknown_fields(issues, body, CONFIRM_FIELDS)
    _unknown_params(issues, query_names)
    issues.raise_if_any()
    return ConfirmRequest(idempotency_key, body["draft_id"], body["station_id"], body["family_code"], body["quantity"])


def parse_draft_id(draft_id: str, query_names=()) -> str:
    """GET /api/v1/reservation-drafts/{draft_id}: path first, then unknown query parameters."""
    issues = _Issues()
    if not UUID_RE.match(draft_id):
        issues.add("draft_id", "INVALID_FORMAT", "draft_id phải là UUID chữ thường.")
    _unknown_params(issues, query_names)
    issues.raise_if_any()
    return draft_id
