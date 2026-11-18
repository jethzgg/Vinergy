"""Unit tests for the shared query validator (§1.2, §2.3, AE-07)."""

import pytest

from app.errors import ApiError
from app.stations.validation import parse_detail_query, parse_search_query

VALID = [("lat", "21.005"), ("lng", "105.8435"), ("service_type", "SWAPPING"), ("family_code", "FAM_A")]


def replace(items, name, value):
    return [(k, value if k == name else v) for k, v in items]


def drop(items, name):
    return [(k, v) for k, v in items if k != name]


def details_of(items, parser=parse_search_query):
    with pytest.raises(ApiError) as exc:
        parser(items)
    assert exc.value.status == 400
    assert exc.value.code == "INVALID_INPUT"
    return [(d["field"], d["reason"]) for d in exc.value.details]


# --- Happy path / defaults (AE-07d) ------------------------------------------

def test_valid_query_with_defaults():
    q = parse_search_query(VALID)
    assert q.echo() == {
        "lat": 21.005, "lng": 105.8435, "service_type": "SWAPPING",
        "family_code": "FAM_A", "only_open": True, "radius_km": None,
    }


def test_only_open_false_and_radius():
    q = parse_search_query(VALID + [("only_open", "false"), ("radius_km", "2")])
    assert q.only_open is False
    assert q.radius_km == 2


def test_negative_zero_normalised():
    q = parse_search_query(replace(VALID, "lat", "-0"))
    assert q.lat == 0 and str(q.lat) == "0.0"


@pytest.mark.parametrize("lat", ["-90", "90", "0", "-12.5"])
def test_lat_boundaries_accepted(lat):
    assert parse_search_query(replace(VALID, "lat", lat)).lat == float(lat)


@pytest.mark.parametrize("lng", ["-180", "180"])
def test_lng_boundaries_accepted(lng):
    assert parse_search_query(replace(VALID, "lng", lng)).lng == float(lng)


# --- AE-07a: coordinates ------------------------------------------------------

@pytest.mark.parametrize("name", ["lat", "lng"])
def test_missing_coordinate_required(name):
    assert details_of(drop(VALID, name)) == [(name, "REQUIRED")]


@pytest.mark.parametrize("bad", ["abc", "21abc", "1e3", "+1", ".5", " 21", "21.", "NaN", "Infinity", "1" * 400])
def test_not_a_number(bad):
    assert details_of(replace(VALID, "lat", bad)) == [("lat", "NOT_A_NUMBER")]


@pytest.mark.parametrize("name,value", [("lat", "90.0001"), ("lat", "-91"), ("lng", "180.5"), ("lng", "-181")])
def test_out_of_range(name, value):
    assert details_of(replace(VALID, name, value)) == [(name, "OUT_OF_RANGE")]


# --- AE-07b: service / family -------------------------------------------------

@pytest.mark.parametrize("name", ["service_type", "family_code"])
def test_missing_enum_required(name):
    assert details_of(drop(VALID, name)) == [(name, "REQUIRED")]


@pytest.mark.parametrize(
    "name,bad",
    [("service_type", "swapping"), ("service_type", "BOTH"), ("family_code", "fam_a"), ("family_code", "FAM_C")],
)
def test_enum_case_sensitive(name, bad):
    assert details_of(replace(VALID, name, bad)) == [(name, "NOT_IN_ENUM")]


# --- AE-07c: radius -----------------------------------------------------------

@pytest.mark.parametrize("bad", ["0", "-1", "-0"])
def test_radius_not_positive(bad):
    assert details_of(VALID + [("radius_km", bad)]) == [("radius_km", "NOT_POSITIVE")]


@pytest.mark.parametrize("bad", ["abc", "Infinity", "1e2"])
def test_radius_not_a_number(bad):
    assert details_of(VALID + [("radius_km", bad)]) == [("radius_km", "NOT_A_NUMBER")]


# --- AE-07e: only_open --------------------------------------------------------

@pytest.mark.parametrize("bad", ["1", "0", "yes", "TRUE", "False"])
def test_only_open_not_boolean(bad):
    assert details_of(VALID + [("only_open", bad)]) == [("only_open", "NOT_BOOLEAN")]


# --- Generic rules ------------------------------------------------------------

@pytest.mark.parametrize("name", ["lat", "service_type", "only_open", "radius_km"])
def test_empty_value(name):
    items = drop(VALID, name) + [(name, "")]
    assert details_of(items) == [(name, "EMPTY")]


def test_duplicate_param():
    assert details_of(VALID + [("lat", "21.1")]) == [("lat", "DUPLICATE_PARAM")]


def test_unknown_params_reported_once_in_order():
    items = VALID + [("radius", "5"), ("zoom", "3"), ("radius", "6")]
    assert details_of(items) == [("radius", "UNKNOWN_PARAM"), ("zoom", "UNKNOWN_PARAM")]


def test_collects_all_errors_in_table_order():
    # AE-07 contract example: lat missing + radius_km=0, plus extra noise.
    items = [("zoom", "1"), ("radius_km", "0"), ("family_code", "X"), ("lng", "105.8435"), ("service_type", "SWAPPING")]
    assert details_of(items) == [
        ("lat", "REQUIRED"),
        ("family_code", "NOT_IN_ENUM"),
        ("radius_km", "NOT_POSITIVE"),
        ("zoom", "UNKNOWN_PARAM"),
    ]


def test_error_details_have_safe_messages():
    with pytest.raises(ApiError) as exc:
        parse_search_query(drop(VALID, "lat"))
    detail = exc.value.details[0]
    assert set(detail) == {"field", "reason", "message"}
    assert detail["message"]


# --- Detail query (§4.4) ------------------------------------------------------

def test_detail_without_query():
    q = parse_detail_query("ST-04", [])
    assert q.echo() == {"family_code": None, "lat": None, "lng": None}
    assert q.origin is None


def test_detail_with_all_params():
    q = parse_detail_query("ST-04", [("family_code", "FAM_A"), ("lat", "21.005"), ("lng", "105.8435")])
    assert q.origin == (21.005, 105.8435)
    assert q.family_code == "FAM_A"


@pytest.mark.parametrize("bad_id", ["st-01", "ST_01", "ST 01", "A" * 33, "ST-01!"])
def test_detail_invalid_station_id(bad_id):
    assert details_of([], lambda items: parse_detail_query(bad_id, items)) == [("station_id", "INVALID_FORMAT")]


@pytest.mark.parametrize("present,missing", [("lat", "lng"), ("lng", "lat")])
def test_detail_missing_pair(present, missing):
    items = [(present, "21.005" if present == "lat" else "105.8435")]
    assert details_of(items, lambda i: parse_detail_query("ST-01", i)) == [(missing, "MISSING_PAIR")]


def test_detail_rejects_search_only_params():
    assert details_of([("service_type", "SWAPPING")], lambda i: parse_detail_query("ST-01", i)) == [
        ("service_type", "UNKNOWN_PARAM")
    ]


def test_detail_invalid_family_and_id_together():
    assert details_of([("family_code", "FAM_Z")], lambda i: parse_detail_query("bad id", i)) == [
        ("station_id", "INVALID_FORMAT"),
        ("family_code", "NOT_IN_ENUM"),
    ]
