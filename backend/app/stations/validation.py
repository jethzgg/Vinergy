"""Shared query validator (api_contracts §1.2, §2.3; AD-06).

Works on the raw multi-valued query items so it can detect EMPTY / DUPLICATE_PARAM /
UNKNOWN_PARAM, and collects every error instead of stopping at the first one.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Optional

from app.errors import ApiError
from app.stations.domain import FAMILY_CODES, SERVICE_TYPES

NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")
STATION_ID_RE = re.compile(r"^[A-Z0-9-]{1,32}$")

_MISSING = object()


@dataclass
class _Issue:
    field: str
    reason: str
    message: str

    def as_dict(self) -> dict:
        return {"field": self.field, "reason": self.reason, "message": self.message}


class _Collector:
    """Groups the raw query string into known/unknown params and records issues."""

    def __init__(self, items: list, allowed: tuple):
        self.allowed = allowed
        self.values: dict = {}
        self.unknown: list = []
        for name, value in items:
            if name in allowed:
                self.values.setdefault(name, []).append(value)
            elif name not in self.unknown:
                self.unknown.append(name)
        self.issues: dict = {}

    def add(self, name: str, reason: str, message: str) -> None:
        self.issues.setdefault(name, _Issue(name, reason, message))

    def raw(self, name: str):
        """Single raw string, or _MISSING. Records DUPLICATE_PARAM / EMPTY."""
        vals = self.values.get(name)
        if vals is None:
            return _MISSING
        if len(vals) > 1:
            self.add(name, "DUPLICATE_PARAM", f"{name} chỉ được xuất hiện một lần.")
            return None
        if vals[0] == "":
            self.add(name, "EMPTY", f"{name} không được để trống.")
            return None
        return vals[0]

    def present(self, name: str) -> bool:
        return name in self.values

    def number(self, name: str, required: bool):
        raw = self.raw(name)
        if raw is _MISSING:
            if required:
                self.add(name, "REQUIRED", f"{name} là bắt buộc.")
            return None
        if raw is None:
            return None
        value = float(raw) if NUMBER_RE.match(raw) else math.nan
        if not math.isfinite(value):
            self.add(name, "NOT_A_NUMBER", f"{name} phải là số hợp lệ.")
            return None
        return value + 0.0  # -0.0 -> 0.0

    def enum(self, name: str, allowed: tuple, required: bool):
        raw = self.raw(name)
        if raw is _MISSING:
            if required:
                self.add(name, "REQUIRED", f"{name} là bắt buộc.")
            return None
        if raw is None:
            return None
        if raw not in allowed:
            self.add(name, "NOT_IN_ENUM", f"{name} phải là một trong: {', '.join(allowed)}.")
            return None
        return raw

    def boolean(self, name: str, default: bool) -> bool:
        raw = self.raw(name)
        if raw is _MISSING or raw is None:
            return default
        if raw not in ("true", "false"):
            self.add(name, "NOT_BOOLEAN", f"{name} phải là true hoặc false.")
            return default
        return raw == "true"

    def raise_if_any(self, order: tuple) -> None:
        details = [self.issues[n].as_dict() for n in order if n in self.issues]
        details += [
            _Issue(n, "UNKNOWN_PARAM", f"Tham số {n} không được hỗ trợ.").as_dict() for n in self.unknown
        ]
        if details:
            raise ApiError.invalid_input(details)


def _check_lat(c: _Collector, lat) -> None:
    if lat is not None and not -90 <= lat <= 90:
        c.add("lat", "OUT_OF_RANGE", "lat phải nằm trong [-90, 90].")


def _check_lng(c: _Collector, lng) -> None:
    if lng is not None and not -180 <= lng <= 180:
        c.add("lng", "OUT_OF_RANGE", "lng phải nằm trong [-180, 180].")


@dataclass(frozen=True)
class SearchQuery:
    lat: float
    lng: float
    service_type: str
    family_code: str
    only_open: bool = True
    radius_km: Optional[float] = None

    def echo(self) -> dict:
        return {
            "lat": self.lat,
            "lng": self.lng,
            "service_type": self.service_type,
            "family_code": self.family_code,
            "only_open": self.only_open,
            "radius_km": self.radius_km,
        }


SEARCH_PARAMS = ("lat", "lng", "service_type", "family_code", "only_open", "radius_km")


def parse_search_query(items: list) -> SearchQuery:
    """Validate GET /api/v1/stations query items (§4.3)."""
    c = _Collector(items, SEARCH_PARAMS)
    lat = c.number("lat", required=True)
    lng = c.number("lng", required=True)
    service_type = c.enum("service_type", SERVICE_TYPES, required=True)
    family_code = c.enum("family_code", FAMILY_CODES, required=True)
    only_open = c.boolean("only_open", default=True)
    radius_km = c.number("radius_km", required=False)

    _check_lat(c, lat)
    _check_lng(c, lng)
    if radius_km is not None and radius_km <= 0:
        c.add("radius_km", "NOT_POSITIVE", "radius_km phải lớn hơn 0.")

    c.raise_if_any(SEARCH_PARAMS)
    return SearchQuery(lat, lng, service_type, family_code, only_open, radius_km)


@dataclass(frozen=True)
class DetailQuery:
    station_id: str
    family_code: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None

    @property
    def origin(self) -> Optional[tuple]:
        return None if self.lat is None else (self.lat, self.lng)

    def echo(self) -> dict:
        return {"family_code": self.family_code, "lat": self.lat, "lng": self.lng}


DETAIL_PARAMS = ("family_code", "lat", "lng")


def parse_detail_query(station_id: str, items: list) -> DetailQuery:
    """Validate GET /api/v1/stations/{station_id} path + query (§4.4)."""
    c = _Collector(items, DETAIL_PARAMS)
    if not STATION_ID_RE.match(station_id):
        c.add("station_id", "INVALID_FORMAT", "station_id phải khớp ^[A-Z0-9-]{1,32}$.")

    family_code = c.enum("family_code", FAMILY_CODES, required=False)
    lat = c.number("lat", required=False)
    lng = c.number("lng", required=False)
    _check_lat(c, lat)
    _check_lng(c, lng)

    # lat/lng must come together; MISSING_PAIR names the absent one.
    if c.present("lat") and not c.present("lng"):
        c.add("lng", "MISSING_PAIR", "lng phải đi cùng lat.")
    elif c.present("lng") and not c.present("lat"):
        c.add("lat", "MISSING_PAIR", "lat phải đi cùng lng.")

    c.raise_if_any(("station_id",) + DETAIL_PARAMS)
    return DetailQuery(station_id, family_code, lat, lng)
