"""Unit tests: reservation request validation (api_contracts §1.3, §6.2; AE-08) and session tokens. No DB."""

import pytest

from app import demo_session
from app.errors import ApiError
from app.reservations.config import ReservationSettings
from app.reservations.validation import (
    ConfirmRequest,
    check_content_type,
    parse_confirm_request,
    parse_draft_id,
    parse_draft_request,
    parse_json_object,
)

DRAFT_ID = "9a7e3c52-1f4b-4d8a-b6c2-0e5f7a9b1d34"
KEY = "8b2f6c1a-3d4e-4f5a-9b6c-7d8e9f0a1b2c"
CONFIRM = {"draft_id": DRAFT_ID, "station_id": "ST-01", "family_code": "FAM_A", "quantity": 1}


def details(exc_info) -> list:
    assert exc_info.value.status == 400 and exc_info.value.code == "INVALID_INPUT"
    return [(d["field"], d["reason"]) for d in exc_info.value.details]


# --- body / content type -----------------------------------------------------------------

@pytest.mark.parametrize("raw", [b"", b"{", b"[1]", b'"x"', b"null", b'{"quantity": NaN}', b"\xff"])
def test_body_must_be_a_json_object(raw):
    with pytest.raises(ApiError) as exc:
        parse_json_object(raw)
    assert (exc.value.status, exc.value.code, exc.value.details) == (400, "INVALID_INPUT", [])


@pytest.mark.parametrize("content_type", [None, "text/plain", "application/x-www-form-urlencoded"])
def test_body_with_wrong_content_type_is_415(content_type):
    with pytest.raises(ApiError) as exc:
        check_content_type(content_type, has_body=True)
    assert (exc.value.status, exc.value.code) == (415, "UNSUPPORTED_MEDIA_TYPE")


@pytest.mark.parametrize("content_type", ["application/json", "Application/JSON; charset=utf-8"])
def test_json_content_type_accepted(content_type):
    check_content_type(content_type, has_body=True)


def test_no_body_and_no_content_type_goes_on_to_validation():
    check_content_type(None, has_body=False)


# --- AE-08: quantity is exactly the JSON integer 1 ------------------------------------------

@pytest.mark.parametrize(
    "quantity, reason",
    [(0, "MUST_BE_ONE"), (-1, "MUST_BE_ONE"), (2, "MUST_BE_ONE"), (1.5, "MUST_BE_ONE"), (1.0, "MUST_BE_ONE"),
     ("1", "NOT_A_NUMBER"), (True, "NOT_A_NUMBER"), ([1], "NOT_A_NUMBER"), (None, "NOT_A_NUMBER"),
     (float("inf"), "NOT_A_NUMBER")],
)
def test_ae08_quantity_rejected_on_draft_and_confirm(quantity, reason):
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": "FAM_A", "quantity": quantity, "station_id": "ST-01"})
    assert details(exc) == [("quantity", reason)]
    with pytest.raises(ApiError) as exc:
        parse_confirm_request(KEY, {**CONFIRM, "quantity": quantity})
    assert details(exc) == [("quantity", reason)]


def test_missing_quantity_is_required():
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": "FAM_A", "station_id": "ST-01"})
    assert details(exc) == [("quantity", "REQUIRED")]


# --- draft body ----------------------------------------------------------------------------

def test_valid_draft_by_station_and_by_nearest():
    by_station = parse_draft_request({"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01"})
    assert (by_station.station_id, by_station.nearest) == ("ST-01", None)
    by_nearest = parse_draft_request({"family_code": "FAM_B", "quantity": 1, "nearest": {"lat": 21, "lng": 105.8}})
    assert (by_nearest.station_id, by_nearest.nearest) == (None, (21.0, 105.8, None))
    with_radius = parse_draft_request(
        {"family_code": "FAM_A", "quantity": 1, "nearest": {"lat": 21.0, "lng": 105.8, "radius_km": 5}}
    )
    assert with_radius.nearest == (21.0, 105.8, 5.0)


def test_draft_needs_exactly_one_of_station_id_and_nearest():
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": "FAM_A", "quantity": 1})
    assert details(exc) == [("station_id", "ONE_OF_REQUIRED")]
    with pytest.raises(ApiError) as exc:
        parse_draft_request(
            {"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01", "nearest": {"lat": 21, "lng": 105}}
        )
    assert details(exc) == [("nearest", "MUTUALLY_EXCLUSIVE")]


def test_draft_collects_every_error_in_table_order():
    body = {
        "owner": "USER-B",
        "nearest": {"lat": 91, "lng": "105", "radius_km": 0, "zoom": 3},
        "quantity": 2,
        "family_code": "FAM_C",
    }
    with pytest.raises(ApiError) as exc:
        parse_draft_request(body)
    assert details(exc) == [
        ("family_code", "NOT_IN_ENUM"),
        ("quantity", "MUST_BE_ONE"),
        ("nearest.lat", "OUT_OF_RANGE"),
        ("nearest.lng", "NOT_A_NUMBER"),
        ("nearest.radius_km", "NOT_POSITIVE"),
        ("nearest.zoom", "UNKNOWN_FIELD"),
        ("owner", "UNKNOWN_FIELD"),
    ]


@pytest.mark.parametrize("station_id", ["st-01", "", "ST 01", 1, None, "A" * 33])
def test_draft_station_id_format(station_id):
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": "FAM_A", "quantity": 1, "station_id": station_id})
    assert details(exc) == [("station_id", "INVALID_FORMAT")]


@pytest.mark.parametrize("family, reason", [(None, "INVALID_FORMAT"), (1, "INVALID_FORMAT"), ("fam_a", "NOT_IN_ENUM")])
def test_draft_family_code(family, reason):
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": family, "quantity": 1, "station_id": "ST-01"})
    assert details(exc) == [("family_code", reason)]


@pytest.mark.parametrize("field", ["user_id", "owner", "demo_user", "origin"])
def test_identity_and_origin_fields_are_rejected_not_ignored(field):
    """BR-10 / §3.4: identity only comes from the session; extra fields are UNKNOWN_FIELD."""
    with pytest.raises(ApiError) as exc:
        parse_draft_request({"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01", field: "USER-B"})
    assert details(exc) == [(field, "UNKNOWN_FIELD")]


# --- confirm body and Idempotency-Key ---------------------------------------------------------

def test_valid_confirm():
    req = parse_confirm_request(KEY, CONFIRM)
    assert req == ConfirmRequest(KEY, DRAFT_ID, "ST-01", "FAM_A", 1)


def test_confirm_rejects_old_rev2_payload():
    """Prototype rev 2 sent {draft_id, draft_revision, quantity} (api_contracts §6.12 row 1)."""
    with pytest.raises(ApiError) as exc:
        parse_confirm_request(KEY, {"draft_id": DRAFT_ID, "draft_revision": 1, "quantity": 1})
    assert details(exc) == [
        ("station_id", "REQUIRED"),
        ("family_code", "REQUIRED"),
        ("draft_revision", "UNKNOWN_FIELD"),
    ]


@pytest.mark.parametrize(
    "key, reason",
    [(None, "REQUIRED"), ("", "REQUIRED"), ("short-key", "INVALID_FORMAT"), ("k" * 101, "INVALID_FORMAT"),
     ("has space in the key!!", "INVALID_FORMAT")],
)
def test_idempotency_key_header(key, reason):
    with pytest.raises(ApiError) as exc:
        parse_confirm_request(key, CONFIRM)
    assert details(exc) == [("Idempotency-Key", reason)]


def test_header_error_comes_before_body_errors():
    with pytest.raises(ApiError) as exc:
        parse_confirm_request(None, {"draft_id": "DRAFT-1", "quantity": 1, "station_id": "ST-01", "family_code": "FAM_A"})
    assert details(exc) == [("Idempotency-Key", "REQUIRED"), ("draft_id", "INVALID_FORMAT")]


@pytest.mark.parametrize("draft_id", ["9A7E3C52-1F4B-4D8A-B6C2-0E5F7A9B1D34", "drf_123", "", 7])
def test_confirm_draft_id_must_be_lowercase_uuid(draft_id):
    with pytest.raises(ApiError) as exc:
        parse_confirm_request(KEY, {**CONFIRM, "draft_id": draft_id})
    assert details(exc) == [("draft_id", "INVALID_FORMAT")]


def test_path_draft_id_format():
    assert parse_draft_id(DRAFT_ID) == DRAFT_ID
    with pytest.raises(ApiError) as exc:
        parse_draft_id("not-a-uuid")
    assert details(exc) == [("draft_id", "INVALID_FORMAT")]


def test_request_hash_ignores_key_order_but_not_content():
    """AE-11/AE-12: same 4 fields -> same hash regardless of JSON order; any change -> different hash."""
    a = parse_confirm_request(KEY, CONFIRM)
    b = parse_confirm_request(KEY, dict(reversed(list(CONFIRM.items()))))
    c = parse_confirm_request(KEY, {**CONFIRM, "station_id": "ST-03"})
    assert a.request_hash() == b.request_hash() != c.request_hash()
    assert len(a.request_hash()) == 64


# --- session tokens and settings ------------------------------------------------------------

def test_session_hash_and_csrf_are_derived_and_distinct():
    raw = demo_session.new_raw_sid()
    assert len(raw) == 43 and "=" not in raw  # 32 bytes, base64url without padding
    h = demo_session.session_token_hash("secret", raw)
    assert len(h) == 64 and h == demo_session.session_token_hash("secret", raw)
    assert h != demo_session.session_token_hash("other-secret", raw)
    token = demo_session.csrf_token_for("secret", raw)
    demo_session.require_csrf("secret", raw, token)
    for wrong in (None, "", token[:-1] + ("A" if token[-1] != "A" else "B"), demo_session.csrf_token_for("secret", "x")):
        with pytest.raises(ApiError) as exc:
            demo_session.require_csrf("secret", raw, wrong)
        assert (exc.value.status, exc.value.code) == (403, "CSRF_INVALID")


def test_settings_defaults_follow_srs_demo_proposal(monkeypatch):
    for name in ("DRAFT_TTL_MINUTES", "RESERVATION_HOLD_MINUTES", "IDEMPOTENCY_LOCK_TIMEOUT_MS"):
        monkeypatch.delenv(name, raising=False)
    assert ReservationSettings.from_env() == ReservationSettings(5, 15, 5000)
    monkeypatch.setenv("RESERVATION_HOLD_MINUTES", "20")
    assert ReservationSettings.from_env().hold_minutes == 20
    with pytest.raises(ValueError):
        ReservationSettings(hold_minutes=0)
