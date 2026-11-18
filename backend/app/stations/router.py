"""HTTP adapter for the Station Service (api_contracts §4.3, §4.4)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.errors import JsonUtf8Response
from app.stations.service import StationService
from app.stations.validation import parse_detail_query, parse_search_query

router = APIRouter(prefix="/api/v1/stations", tags=["stations"])

NO_STORE = {"Cache-Control": "no-store"}


def _service(request: Request) -> StationService:
    return request.app.state.station_service


@router.get("", response_class=JsonUtf8Response)
def search_stations(request: Request) -> JsonUtf8Response:
    """Search/filter stations; query params are validated manually per §1.2."""
    query = parse_search_query(request.query_params.multi_items())
    return JsonUtf8Response(_service(request).search(query), headers=NO_STORE)


@router.get("/{station_id}", response_class=JsonUtf8Response)
def get_station(station_id: str, request: Request) -> JsonUtf8Response:
    query = parse_detail_query(station_id, request.query_params.multi_items())
    return JsonUtf8Response(_service(request).detail(query), headers=NO_STORE)
