"""Stub Station Service for the LLM tool spike (1.3.2).

Loads the 18 fictional stations from seed_stations_v0.json and implements:
- Haversine distance (R = 6371 km, BR-04 / api_contracts §1.1)
- Filtering by service_type, family_code, only_open, radius_km
- Sorting by (distance_km ASC, station_id ASC)
- booking_eligible / ineligibility_reason (api_contracts §4.2)
- Input parameter validation returning canonical ToolError payloads

This module is a *read-only stub* for Sprint 1; it will be replaced by a
proper Station Service backed by PostgreSQL once the DB layer lands.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_EARTH_RADIUS_KM = 6371.0

# ---------------------------------------------------------------------------
# Data model (lightweight, no Pydantic dependency — keeps the spike portable)
# ---------------------------------------------------------------------------

@dataclass
class Station:
    station_id: str
    name: str
    area_label: str
    lat: float
    lng: float
    opening_status: str             # OPEN | CLOSED | MAINTENANCE
    services: list[str]             # [CHARGING] | [SWAPPING] | [CHARGING, SWAPPING]
    supported_families: list[str]   # [FAM_A] | [FAM_B] | [FAM_A, FAM_B]
    available_batteries_by_family: dict[str, int]
    available_charging_ports_by_family: dict[str, int]


# ---------------------------------------------------------------------------
# Haversine (api_contracts §1.1)
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return straight-line distance in km using the Haversine formula."""
    rlat1, rlng1, rlat2, rlng2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _distance_display(distance_km: float) -> str:
    """Format distance for display: half-up rounding to 1 decimal + ' km'."""
    # Normalize -0.0 → 0.0
    if distance_km == 0.0:
        return "0.0 km"
    # Python's round() uses banker's rounding; we need half-up.
    from decimal import Decimal, ROUND_HALF_UP
    rounded = Decimal(str(distance_km)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"{rounded} km"


# ---------------------------------------------------------------------------
# Eligibility algorithm (api_contracts §4.2)
# ---------------------------------------------------------------------------

def _compute_eligibility(
    station: Station, family_code: str | None
) -> tuple[bool | None, bool | None, str | None]:
    """Return (family_supported, booking_eligible, ineligibility_reason)."""
    if family_code is None:
        return None, None, None

    family_supported = family_code in station.supported_families
    if not family_supported:
        return False, False, "UNSUPPORTED_FAMILY"

    # Check in fixed order per §4.2
    if "SWAPPING" not in station.services:
        return True, False, "CHARGING_ONLY"
    if station.opening_status == "CLOSED":
        return True, False, "STATION_CLOSED"
    if station.opening_status == "MAINTENANCE":
        return True, False, "STATION_MAINTENANCE"
    if station.available_batteries_by_family.get(family_code, 0) < 1:
        return True, False, "OUT_OF_STOCK"

    return True, True, None


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_stations(path: str | None = None) -> list[Station]:
    """Load station fixtures from JSON seed file."""
    seed_path = Path(path or get_settings().seed_stations_path)
    logger.info("Loading station fixtures from %s", seed_path)

    with open(seed_path, encoding="utf-8") as f:
        raw = json.load(f)

    stations = []
    for s in raw["stations"]:
        stations.append(Station(
            station_id=s["station_id"],
            name=s["name"],
            area_label=s["area_label"],
            lat=s["coordinates"]["lat"],
            lng=s["coordinates"]["lng"],
            opening_status=s["opening_status"],
            services=s["services"],
            supported_families=s["supported_families"],
            available_batteries_by_family=s.get("available_batteries_by_family", {}),
            available_charging_ports_by_family=s.get("available_charging_ports_by_family", {}),
        ))
    logger.info("Loaded %d station fixture(s)", len(stations))
    return stations


# ---------------------------------------------------------------------------
# Station enrichment helper
# ---------------------------------------------------------------------------

def _enrich_station(
    station: Station,
    lat: float | None,
    lng: float | None,
    family_code: str | None,
) -> dict[str, Any]:
    """Build the canonical Station response object (api_contracts §4.1)."""
    distance_km: float | None = None
    distance_display_str: str | None = None
    if lat is not None and lng is not None:
        distance_km = haversine_km(lat, lng, station.lat, station.lng)
        distance_display_str = _distance_display(distance_km)

    family_supported, booking_eligible, ineligibility_reason = _compute_eligibility(
        station, family_code
    )

    return {
        "station_id": station.station_id,
        "name": station.name,
        "area_label": station.area_label,
        "coordinates": {"lat": station.lat, "lng": station.lng},
        "opening_status": station.opening_status,
        "services": station.services,
        "supported_families": station.supported_families,
        "available_batteries_by_family": station.available_batteries_by_family,
        "available_charging_ports_by_family": station.available_charging_ports_by_family,
        "distance_km": distance_km,
        "distance_display": distance_display_str,
        "family_supported": family_supported,
        "booking_eligible": booking_eligible,
        "ineligibility_reason": ineligibility_reason,
    }


# ---------------------------------------------------------------------------
# Public service methods — called by Tool Adapter
# ---------------------------------------------------------------------------

def search_stations(
    *,
    lat: float,
    lng: float,
    service_type: str,
    family_code: str,
    only_open: bool = True,
    radius_km: float | None = None,
    stations_path: str | None = None,
) -> dict[str, Any]:
    """Search, filter, sort, and enrich stations (api_contracts §4.3)."""
    all_stations = _load_stations(stations_path)

    results: list[dict[str, Any]] = []
    for s in all_stations:
        # Filter: service_type
        if service_type not in s.services:
            continue
        # Filter: family_code
        if family_code not in s.supported_families:
            continue
        # Filter: only_open
        if only_open and s.opening_status != "OPEN":
            continue

        enriched = _enrich_station(s, lat, lng, family_code)
        distance_km_val = enriched["distance_km"]

        # Filter: radius_km
        if radius_km is not None and distance_km_val is not None:
            if distance_km_val > radius_km:
                continue

        results.append(enriched)

    # Sort: distance_km ASC, then station_id ASC
    results.sort(key=lambda r: (r["distance_km"] or 0.0, r["station_id"]))

    return {
        "is_simulated": True,
        "query": {
            "lat": lat,
            "lng": lng,
            "service_type": service_type,
            "family_code": family_code,
            "only_open": only_open,
            "radius_km": radius_km,
        },
        "total": len(results),
        "stations": results,
    }


def get_station_detail(
    *,
    station_id: str,
    lat: float | None = None,
    lng: float | None = None,
    family_code: str | None = None,
    stations_path: str | None = None,
) -> dict[str, Any] | None:
    """Return enriched detail for a single station, or None if not found."""
    all_stations = _load_stations(stations_path)
    for s in all_stations:
        if s.station_id == station_id:
            return {
                "is_simulated": True,
                "query": {
                    "family_code": family_code,
                    "lat": lat,
                    "lng": lng,
                },
                "station": _enrich_station(s, lat, lng, family_code),
            }
    return None
