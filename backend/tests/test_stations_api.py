"""HTTP tests for /api/v1/stations against the SQL repository (migrations + seed.sql)."""

import re

import pytest

from tests.conftest import LOC_01_ORACLE

SEARCH = "/api/v1/stations"
AE01 = SEARCH + "?lat=21.005&lng=105.8435&service_type=SWAPPING&family_code=FAM_A&radius_km=2"
REQUEST_ID_RE = re.compile(r"^req_[0-9A-HJKMNP-TV-Z]{26}$")


def assert_station_headers(response):
    assert response.headers["content-type"] == "application/json; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert REQUEST_ID_RE.match(response.headers["x-request-id"])


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error", "request_id"}
    assert body["error"]["code"] == code
    assert body["request_id"] == response.headers["x-request-id"]
    return body["error"]["details"]


# --- Search ------------------------------------------------------------------

def test_ae01_full_contract_example(client):
    response = client.get(AE01)
    assert response.status_code == 200
    assert_station_headers(response)
    body = response.json()
    assert body["query"] == {"lat": 21.005, "lng": 105.8435, "service_type": "SWAPPING",
                             "family_code": "FAM_A", "only_open": True, "radius_km": 2}
    assert body["total"] == 4
    first = body["stations"][0]
    assert first == {
        "station_id": "ST-01",
        "name": "Vinergy Demo Station 01",
        "area_label": "Hai Ba Trung demo area",
        "coordinates": {"lat": 21.005, "lng": 105.8435},
        "opening_status": "OPEN",
        "services": ["CHARGING", "SWAPPING"],
        "supported_families": ["FAM_A", "FAM_B"],
        "available_batteries_by_family": {"FAM_A": 6, "FAM_B": 4},
        "available_charging_ports_by_family": {"FAM_A": 3, "FAM_B": 2},
        "distance_km": 0.0,
        "distance_display": "0.0 km",
        "family_supported": True,
        "booking_eligible": True,
        "ineligibility_reason": None,
    }
    assert [s["station_id"] for s in body["stations"]] == ["ST-01", "ST-03", "ST-05", "ST-06"]
    for station in body["stations"]:
        assert station["distance_km"] == pytest.approx(LOC_01_ORACLE[station["station_id"]][0], abs=1e-6)


def test_sql_and_fixture_repositories_agree(client, service):
    from app.stations.validation import parse_search_query

    for service_type in ("CHARGING", "SWAPPING"):
        for family in ("FAM_A", "FAM_B"):
            params = {"lat": "21.005", "lng": "105.8435", "service_type": service_type,
                      "family_code": family, "only_open": "false"}
            via_http = client.get(SEARCH, params=params).json()
            via_fixture = service.search(parse_search_query(list(params.items())))
            assert via_http == via_fixture


def test_ae05_empty_result_is_200(client):
    response = client.get(SEARCH + "?lat=21.2&lng=105.2&service_type=SWAPPING&family_code=FAM_A&radius_km=0.5")
    assert response.status_code == 200
    assert_station_headers(response)
    assert response.json()["stations"] == []
    assert response.json()["total"] == 0


def test_ae07_contract_error_example(client):
    response = client.get(SEARCH + "?lng=105.8435&service_type=SWAPPING&family_code=FAM_A&radius_km=0")
    details = assert_error(response, 400, "INVALID_INPUT")
    assert [(d["field"], d["reason"]) for d in details] == [("lat", "REQUIRED"), ("radius_km", "NOT_POSITIVE")]


@pytest.mark.parametrize(
    "query,expected",
    [
        ("lat=&lng=105.8&service_type=SWAPPING&family_code=FAM_A", [("lat", "EMPTY")]),
        ("lat&lng=105.8&service_type=SWAPPING&family_code=FAM_A", [("lat", "EMPTY")]),
        ("lat=1&lat=2&lng=105.8&service_type=SWAPPING&family_code=FAM_A", [("lat", "DUPLICATE_PARAM")]),
        ("lat=21&lng=105.8&service_type=SWAPPING&family_code=FAM_A&radius=5", [("radius", "UNKNOWN_PARAM")]),
        ("lat=21&lng=105.8&service_type=SWAPPING&family_code=FAM_A&only_open=1", [("only_open", "NOT_BOOLEAN")]),
        ("lat=1e3&lng=105.8&service_type=SWAPPING&family_code=FAM_A", [("lat", "NOT_A_NUMBER")]),
        ("lat=%2B1&lng=105.8&service_type=SWAPPING&family_code=FAM_A", [("lat", "NOT_A_NUMBER")]),
    ],
)
def test_query_parsing_over_http(client, query, expected):
    details = assert_error(client.get(SEARCH + "?" + query), 400, "INVALID_INPUT")
    assert [(d["field"], d["reason"]) for d in details] == expected


# --- Detail ------------------------------------------------------------------

def test_ae02_detail_contract_example(client):
    response = client.get(SEARCH + "/ST-04?family_code=FAM_A&lat=21.005&lng=105.8435")
    assert response.status_code == 200
    assert_station_headers(response)
    body = response.json()
    assert body["is_simulated"] is True
    assert body["query"] == {"family_code": "FAM_A", "lat": 21.005, "lng": 105.8435}
    station = body["station"]
    assert station["supported_families"] == ["FAM_B"]
    assert station["available_batteries_by_family"] == {"FAM_B": 5}
    assert station["available_charging_ports_by_family"] == {}
    assert station["distance_km"] == pytest.approx(1.284228856998922, abs=1e-6)
    assert (station["family_supported"], station["booking_eligible"], station["ineligibility_reason"]) == (
        False, False, "UNSUPPORTED_FAMILY")


def test_detail_without_query(client):
    body = client.get(SEARCH + "/ST-13").json()
    assert body["query"] == {"family_code": None, "lat": None, "lng": None}
    assert body["station"]["opening_status"] == "MAINTENANCE"
    assert body["station"]["booking_eligible"] is None


def test_detail_invalid_format_is_400_not_404(client):
    details = assert_error(client.get(SEARCH + "/st-01"), 400, "INVALID_INPUT")
    assert details[0]["field"] == "station_id" and details[0]["reason"] == "INVALID_FORMAT"


def test_detail_not_found(client):
    details = assert_error(client.get(SEARCH + "/ST-99"), 404, "STATION_NOT_FOUND")
    assert details == []


def test_detail_missing_pair(client):
    details = assert_error(client.get(SEARCH + "/ST-01?lat=21.005"), 400, "INVALID_INPUT")
    assert [(d["field"], d["reason"]) for d in details] == [("lng", "MISSING_PAIR")]


def test_validation_runs_before_lookup(client):
    # Bad query on a non-existent station is still 400 (validate before 404, §1.3).
    assert_error(client.get(SEARCH + "/ST-99?family_code=FAM_Z"), 400, "INVALID_INPUT")


# --- Routing / envelope -------------------------------------------------------

@pytest.mark.parametrize("method,path", [("GET", "/api/v1/nope"), ("POST", SEARCH), ("DELETE", SEARCH + "/ST-01"),
                                         ("GET", SEARCH + "/")])
def test_unknown_route_or_method(client, method, path):
    assert_error(client.request(method, path), 404, "ROUTE_NOT_FOUND")


def test_internal_error_hides_details(client, monkeypatch):
    from app.main import app

    class Boom:
        def search(self, q):
            raise RuntimeError("SELECT secret FROM station")

    monkeypatch.setattr(app.state, "station_service", Boom())
    response = client.get(AE01)
    assert_error(response, 500, "INTERNAL_ERROR")
    assert "secret" not in response.text
