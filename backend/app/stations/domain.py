"""Pure station domain rules: distance (BR-04), booking eligibility (§4.2) and filtering (§4.3).

No I/O here, so every rule can be unit-tested directly against the AE oracle values.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

EARTH_RADIUS_KM = 6371.0

SERVICE_TYPES = ("CHARGING", "SWAPPING")
FAMILY_CODES = ("FAM_A", "FAM_B")
OPENING_STATUSES = ("OPEN", "CLOSED", "MAINTENANCE")


@dataclass(frozen=True)
class Station:
    station_id: str
    name: str
    area_label: str
    lat: float
    lng: float
    opening_status: str
    # Key absent != value 0 (api_contracts §4.1): only families with a resource row appear.
    available_batteries_by_family: dict = field(default_factory=dict)
    available_charging_ports_by_family: dict = field(default_factory=dict)

    @property
    def services(self) -> list:
        result = []
        if self.available_charging_ports_by_family:
            result.append("CHARGING")
        if self.available_batteries_by_family:
            result.append("SWAPPING")
        return result

    @property
    def supported_families(self) -> list:
        families = set(self.available_batteries_by_family) | set(self.available_charging_ports_by_family)
        return sorted(families)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance, exactly as api_contracts §1.1 (R = 6371 km)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def format_distance(distance_km: float) -> str:
    """Half-up to one decimal + " km"; display only, never used for sorting."""
    rounded = Decimal(repr(distance_km)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = Decimal("0.0")  # normalise -0.0
    return f"{rounded} km"


def booking_eligibility(station: Station, family_code: str) -> tuple:
    """Return (booking_eligible, ineligibility_reason); first matching rule wins (§4.2).

    Independent of the searched service_type, so a CHARGING search still answers
    "can I reserve one swap battery here right now?" (AE-19).
    """
    if "SWAPPING" not in station.services:
        return False, "CHARGING_ONLY"
    if family_code not in station.supported_families:
        return False, "UNSUPPORTED_FAMILY"
    if station.opening_status == "CLOSED":
        return False, "STATION_CLOSED"
    if station.opening_status == "MAINTENANCE":
        return False, "STATION_MAINTENANCE"
    if station.available_batteries_by_family.get(family_code, 0) < 1:
        return False, "OUT_OF_STOCK"
    return True, None


def matches_search(
    station: Station,
    service_type: str,
    family_code: str,
    only_open: bool,
) -> bool:
    """Filter conditions 1-3 of §4.3. Stock is deliberately NOT checked (BR-03)."""
    if service_type not in station.services:
        return False
    if family_code not in station.supported_families:
        return False
    if only_open and station.opening_status != "OPEN":
        return False
    return True


def to_view(
    station: Station,
    family_code: Optional[str] = None,
    origin: Optional[tuple] = None,
) -> dict:
    """Serialise to the shared `Station` object of §4.1 (every field always present)."""
    if origin is not None:
        distance_km = haversine_km(origin[0], origin[1], station.lat, station.lng)
        distance_display = format_distance(distance_km)
    else:
        distance_km = distance_display = None

    if family_code is not None:
        family_supported = family_code in station.supported_families
        booking_eligible, reason = booking_eligibility(station, family_code)
    else:
        family_supported = booking_eligible = reason = None

    return {
        "station_id": station.station_id,
        "name": station.name,
        "area_label": station.area_label,
        "coordinates": {"lat": station.lat, "lng": station.lng},
        "opening_status": station.opening_status,
        "services": station.services,
        "supported_families": station.supported_families,
        "available_batteries_by_family": dict(sorted(station.available_batteries_by_family.items())),
        "available_charging_ports_by_family": dict(sorted(station.available_charging_ports_by_family.items())),
        "distance_km": distance_km,
        "distance_display": distance_display,
        "family_supported": family_supported,
        "booking_eligible": booking_eligible,
        "ineligibility_reason": reason,
    }
