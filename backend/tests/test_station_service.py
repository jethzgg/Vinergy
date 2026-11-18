"""Unit tests for StationService search/detail against the seed fixture (AE-01..AE-07)."""

import dataclasses

import pytest

from app.errors import ApiError
from app.stations.domain import haversine_km
from app.stations.repository import InMemoryStationRepository
from app.stations.service import StationService
from app.stations.validation import DetailQuery, SearchQuery
from tests.conftest import LOC_01, LOC_01_ORACLE, LOC_02, LOC_03


def search(service, service_type="SWAPPING", family_code="FAM_A", origin=LOC_01, only_open=True, radius_km=None):
    return service.search(SearchQuery(origin[0], origin[1], service_type, family_code, only_open, radius_km))


def ids(result):
    return [s["station_id"] for s in result["stations"]]


# --- AE-01: compatible stations, sorted by straight-line distance ------------

def test_ae01_order_and_display(service):
    result = search(service, radius_km=2)
    assert ids(result) == ["ST-01", "ST-03", "ST-05", "ST-06"]
    assert [s["distance_display"] for s in result["stations"]] == ["0.0 km", "0.9 km", "1.3 km", "1.7 km"]
    assert result["total"] == 4
    assert result["is_simulated"] is True


def test_ae01_out_of_stock_station_listed_but_not_bookable(service):
    st05 = next(s for s in search(service, radius_km=2)["stations"] if s["station_id"] == "ST-05")
    assert st05["available_batteries_by_family"]["FAM_A"] == 0
    assert st05["family_supported"] is True
    assert (st05["booking_eligible"], st05["ineligibility_reason"]) == (False, "OUT_OF_STOCK")


def test_sorted_by_unrounded_distance_not_label(service):
    # ST-04 (1.284) and ST-05 (1.313) both display "1.3 km" for FAM_B; raw distance decides.
    result = search(service, family_code="FAM_B", radius_km=1.5)
    assert ids(result) == ["ST-01", "ST-04", "ST-05"]
    distances = [s["distance_km"] for s in result["stations"]]
    assert distances == sorted(distances)


def test_distances_match_oracle_without_radius(service):
    result = search(service, only_open=False)
    for station in result["stations"]:
        assert station["distance_km"] == pytest.approx(LOC_01_ORACLE[station["station_id"]][0], abs=1e-6)


def test_ae01_equal_distance_tie_broken_by_station_id(repo):
    # Independent copy: move ST-03 onto ST-01 and feed records in reverse order.
    st01, st03 = repo.get("ST-01"), repo.get("ST-03")
    moved = dataclasses.replace(st03, lat=st01.lat, lng=st01.lng)
    others = [s for s in repo.list_all() if s.station_id not in ("ST-01", "ST-03")]
    service = StationService(InMemoryStationRepository([moved, *reversed(others), st01]))
    result = search(service, radius_km=2)
    assert ids(result)[:2] == ["ST-01", "ST-03"]
    assert result["stations"][0]["distance_km"] == result["stations"][1]["distance_km"] == 0.0


def test_radius_is_inclusive(service):
    d = haversine_km(*LOC_01, 21.0115, 105.8492)  # LOC-01 -> ST-03
    assert "ST-03" in ids(search(service, radius_km=d))
    assert "ST-03" not in ids(search(service, radius_km=d - 1e-9))


# --- AE-02: incompatible vs out of stock -------------------------------------

def test_ae02_incompatible_station_excluded_from_search(service):
    assert "ST-04" not in ids(search(service))


def test_ae02_detail_shows_incompatibility(service):
    result = service.detail(DetailQuery("ST-04", "FAM_A", *LOC_01))
    station = result["station"]
    assert result["query"] == {"family_code": "FAM_A", "lat": 21.005, "lng": 105.8435}
    assert station["family_supported"] is False
    assert (station["booking_eligible"], station["ineligibility_reason"]) == (False, "UNSUPPORTED_FAMILY")
    assert station["available_batteries_by_family"] == {"FAM_B": 5}
    assert station["distance_km"] == pytest.approx(1.284228856998922, abs=1e-6)
    assert station["distance_display"] == "1.3 km"


# --- AE-03: charging vs swapping ---------------------------------------------

def test_ae03_charging_only_station_in_charging_search(service):
    result = search(service, service_type="CHARGING")
    st02 = next(s for s in result["stations"] if s["station_id"] == "ST-02")
    assert st02["available_charging_ports_by_family"]["FAM_A"] == 5
    assert (st02["booking_eligible"], st02["ineligibility_reason"]) == (False, "CHARGING_ONLY")


def test_ae03_charging_only_station_not_in_swapping_search(service):
    assert "ST-02" not in ids(search(service, service_type="SWAPPING"))


def test_ae19_eligibility_independent_of_service_type(service):
    st01 = next(s for s in search(service, service_type="CHARGING")["stations"] if s["station_id"] == "ST-01")
    assert (st01["booking_eligible"], st01["ineligibility_reason"]) == (True, None)


def test_every_result_offers_requested_service_and_family(service):
    for service_type in ("CHARGING", "SWAPPING"):
        for family in ("FAM_A", "FAM_B"):
            for station in search(service, service_type=service_type, family_code=family, only_open=False)["stations"]:
                assert service_type in station["services"]
                assert family in station["supported_families"]
                assert station["family_supported"] is True


# --- AE-04: manual location changes the result --------------------------------

def test_ae04_manual_location_recomputes_distances(service):
    from_loc01 = search(service)
    from_loc02 = search(service, origin=LOC_02)
    assert from_loc02["query"]["lat"] == LOC_02[0]
    assert ids(from_loc01)[0] == "ST-01"
    assert ids(from_loc02) != ids(from_loc01)


# --- AE-05 / AE-07f: valid empty result ---------------------------------------

def test_ae05_empty_result_is_success(service):
    result = search(service, origin=LOC_03, radius_km=0.5)
    assert result == {
        "is_simulated": True,
        "query": {"lat": 21.2, "lng": 105.2, "service_type": "SWAPPING", "family_code": "FAM_A",
                  "only_open": True, "radius_km": 0.5},
        "total": 0,
        "stations": [],
    }


# --- AE-07d / AE-07e: defaults and only_open ----------------------------------

def test_ae07d_no_radius_considers_all_open_compatible(service):
    expected = {"ST-01", "ST-03", "ST-05", "ST-06", "ST-08", "ST-10", "ST-11", "ST-14", "ST-15", "ST-16", "ST-18"}
    assert set(ids(search(service))) == expected


def test_ae07d_default_only_open_excludes_closed_and_maintenance(service):
    assert {"ST-09", "ST-13"}.isdisjoint(ids(search(service)))


def test_ae07e_only_open_false_includes_but_disables_booking(service):
    stations = {s["station_id"]: s for s in search(service, only_open=False)["stations"]}
    assert stations["ST-09"]["ineligibility_reason"] == "STATION_CLOSED"
    assert stations["ST-13"]["ineligibility_reason"] == "STATION_MAINTENANCE"
    assert not stations["ST-09"]["booking_eligible"] and not stations["ST-13"]["booking_eligible"]


def test_search_does_not_mutate_stock(service, repo):
    before = {s.station_id: dict(s.available_batteries_by_family) for s in repo.list_all()}
    search(service, only_open=False)
    service.detail(DetailQuery("ST-01", "FAM_A"))
    assert {s.station_id: dict(s.available_batteries_by_family) for s in repo.list_all()} == before


# --- Detail edge cases --------------------------------------------------------

def test_detail_without_context_returns_nulls(service):
    result = service.detail(DetailQuery("ST-04"))
    assert result["query"] == {"family_code": None, "lat": None, "lng": None}
    for key in ("distance_km", "distance_display", "family_supported", "booking_eligible", "ineligibility_reason"):
        assert result["station"][key] is None


def test_detail_family_only_no_distance(service):
    station = service.detail(DetailQuery("ST-05", "FAM_A"))["station"]
    assert station["distance_km"] is None
    assert station["ineligibility_reason"] == "OUT_OF_STOCK"


def test_detail_unknown_station(service):
    with pytest.raises(ApiError) as exc:
        service.detail(DetailQuery("ST-99"))
    assert (exc.value.status, exc.value.code) == (404, "STATION_NOT_FOUND")
