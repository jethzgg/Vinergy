"""Station Service: the single search/detail implementation shared by HTTP and the LLM tool (§4, §5)."""

from __future__ import annotations

from app.errors import ApiError
from app.stations.domain import haversine_km, matches_search, to_view
from app.stations.repository import StationRepository
from app.stations.validation import DetailQuery, SearchQuery


class StationService:
    def __init__(self, repository: StationRepository):
        self._repo = repository

    def search(self, q: SearchQuery) -> dict:
        candidates = []
        for station in self._repo.list_all():
            if not matches_search(station, q.service_type, q.family_code, q.only_open):
                continue
            distance = haversine_km(q.lat, q.lng, station.lat, station.lng)
            if q.radius_km is not None and distance > q.radius_km:
                continue
            candidates.append((distance, station))

        # Unrounded distance ascending, then station_id by code point (§1.1).
        candidates.sort(key=lambda pair: (pair[0], pair[1].station_id))
        stations = [to_view(s, q.family_code, (q.lat, q.lng)) for _, s in candidates]
        return {
            "is_simulated": True,
            "query": q.echo(),
            "total": len(stations),
            "stations": stations,
        }

    def detail(self, q: DetailQuery) -> dict:
        station = self._repo.get(q.station_id)
        if station is None:
            raise ApiError.station_not_found()
        return {
            "is_simulated": True,
            "query": q.echo(),
            "station": to_view(station, q.family_code, q.origin),
        }
