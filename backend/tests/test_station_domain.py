"""Unit tests for pure domain rules: Haversine, display rounding, eligibility (§1.1, §4.2)."""

import math

import pytest

from app.stations.domain import Station, booking_eligibility, format_distance, haversine_km, matches_search, to_view
from tests.conftest import LOC_01, LOC_01_ORACLE


def make_station(**overrides) -> Station:
    base = dict(
        station_id="ST-99",
        name="Test",
        area_label="Test area",
        lat=21.0,
        lng=105.8,
        opening_status="OPEN",
        available_batteries_by_family={"FAM_A": 2},
        available_charging_ports_by_family={"FAM_A": 1},
    )
    base.update(overrides)
    return Station(**base)


# --- Haversine (BR-04) -------------------------------------------------------

@pytest.mark.parametrize("station_id", sorted(LOC_01_ORACLE))
def test_haversine_matches_ae_oracle(repo, station_id):
    station = repo.get(station_id)
    expected_km, _ = LOC_01_ORACLE[station_id]
    assert haversine_km(*LOC_01, station.lat, station.lng) == pytest.approx(expected_km, abs=1e-6)


def test_haversine_same_point_is_zero():
    assert haversine_km(21.005, 105.8435, 21.005, 105.8435) == 0.0


def test_haversine_is_symmetric():
    assert haversine_km(21.0, 105.8, 21.1, 105.9) == pytest.approx(haversine_km(21.1, 105.9, 21.0, 105.8))


def test_haversine_antipodal_clamped_to_half_circumference():
    assert haversine_km(0, 0, 0, 180) == pytest.approx(math.pi * 6371)


def test_contract_example_values():
    # Exact values printed in api_contracts §4.3 / §4.4 (tolerance 1e-6).
    assert haversine_km(*LOC_01, 21.0115, 105.8492) == pytest.approx(0.9340655580626385, abs=1e-6)
    assert haversine_km(*LOC_01, 21.0118, 105.8335) == pytest.approx(1.284228856998922, abs=1e-6)


# --- distance_display --------------------------------------------------------

@pytest.mark.parametrize("station_id", sorted(LOC_01_ORACLE))
def test_display_matches_ae_oracle(repo, station_id):
    station = repo.get(station_id)
    _, expected_label = LOC_01_ORACLE[station_id]
    assert format_distance(haversine_km(*LOC_01, station.lat, station.lng)) == expected_label


@pytest.mark.parametrize(
    "value,label",
    [
        (0.0, "0.0 km"),
        (-0.0, "0.0 km"),
        (0.04, "0.0 km"),
        (0.05, "0.1 km"),   # half-up, not banker's rounding
        (0.25, "0.3 km"),
        (1.25, "1.3 km"),
        (2.45, "2.5 km"),
        (1.6532, "1.7 km"),
        (12.0, "12.0 km"),
    ],
)
def test_format_distance_half_up(value, label):
    assert format_distance(value) == label


# --- Derived services / families ---------------------------------------------

def test_services_and_families_derived_from_resource_rows():
    s = make_station(available_batteries_by_family={"FAM_B": 0}, available_charging_ports_by_family={"FAM_A": 1})
    assert s.services == ["CHARGING", "SWAPPING"]
    assert s.supported_families == ["FAM_A", "FAM_B"]


def test_charging_only_station_has_no_swapping():
    s = make_station(available_batteries_by_family={})
    assert s.services == ["CHARGING"]


# --- Booking eligibility (§4.2) ----------------------------------------------

@pytest.mark.parametrize(
    "station_id,eligible,reason",
    [
        ("ST-01", True, None),
        ("ST-05", False, "OUT_OF_STOCK"),
        ("ST-02", False, "CHARGING_ONLY"),
        ("ST-04", False, "UNSUPPORTED_FAMILY"),
        ("ST-09", False, "STATION_CLOSED"),
        ("ST-13", False, "STATION_MAINTENANCE"),  # maintenance beats zero stock
    ],
)
def test_eligibility_seed_oracle_fam_a(repo, station_id, eligible, reason):
    assert booking_eligibility(repo.get(station_id), "FAM_A") == (eligible, reason)


def test_eligibility_order_charging_only_before_unsupported():
    s = make_station(available_batteries_by_family={}, available_charging_ports_by_family={"FAM_B": 1})
    assert booking_eligibility(s, "FAM_A") == (False, "CHARGING_ONLY")


def test_eligibility_order_unsupported_before_closed():
    s = make_station(
        opening_status="CLOSED",
        available_batteries_by_family={"FAM_B": 3},
        available_charging_ports_by_family={},
    )
    assert booking_eligibility(s, "FAM_A") == (False, "UNSUPPORTED_FAMILY")


def test_eligibility_closed_before_out_of_stock():
    s = make_station(opening_status="CLOSED", available_batteries_by_family={"FAM_A": 0})
    assert booking_eligibility(s, "FAM_A") == (False, "STATION_CLOSED")


def test_eligibility_family_supported_only_by_charging_is_out_of_stock():
    # FAM_A supported through charging ports but no swap stock row -> key absent -> OUT_OF_STOCK.
    s = make_station(available_batteries_by_family={"FAM_B": 2}, available_charging_ports_by_family={"FAM_A": 1})
    assert booking_eligibility(s, "FAM_A") == (False, "OUT_OF_STOCK")


def test_eligibility_exactly_one_battery_is_enough():
    assert booking_eligibility(make_station(available_batteries_by_family={"FAM_A": 1}), "FAM_A") == (True, None)


# --- Search filter (§4.3 conditions 1-3) -------------------------------------

def test_filter_requires_service(repo):
    assert not matches_search(repo.get("ST-02"), "SWAPPING", "FAM_A", True)
    assert matches_search(repo.get("ST-02"), "CHARGING", "FAM_A", True)


def test_filter_requires_compatibility_not_stock(repo):
    assert not matches_search(repo.get("ST-04"), "SWAPPING", "FAM_A", True)
    assert matches_search(repo.get("ST-05"), "SWAPPING", "FAM_A", True)  # 0 FAM_A stock, still listed


@pytest.mark.parametrize("station_id", ["ST-09", "ST-13"])
def test_filter_only_open(repo, station_id):
    assert not matches_search(repo.get(station_id), "SWAPPING", "FAM_A", True)
    assert matches_search(repo.get(station_id), "SWAPPING", "FAM_A", False)


# --- Station view (§4.1) -----------------------------------------------------

def test_view_without_context_has_nulls(repo):
    view = to_view(repo.get("ST-04"))
    for key in ("distance_km", "distance_display", "family_supported", "booking_eligible", "ineligibility_reason"):
        assert view[key] is None


def test_view_keeps_absent_keys_absent(repo):
    view = to_view(repo.get("ST-03"), "FAM_A", LOC_01)
    assert view["available_batteries_by_family"] == {"FAM_A": 8}
    assert view["available_charging_ports_by_family"] == {}
    assert "FAM_B" not in view["available_batteries_by_family"]


def test_view_field_order_matches_contract(repo):
    assert list(to_view(repo.get("ST-01"))) == [
        "station_id", "name", "area_label", "coordinates", "opening_status", "services",
        "supported_families", "available_batteries_by_family", "available_charging_ports_by_family",
        "distance_km", "distance_display", "family_supported", "booking_eligible", "ineligibility_reason",
    ]
