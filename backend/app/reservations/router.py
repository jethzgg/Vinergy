"""HTTP adapter for reservation drafts and confirmation (api_contracts §6.1, §6.4, §6.5, §6.7).

Checks run in the fixed order of §1.3: route -> session (401) -> Content-Type (415)
-> X-CSRF-Token (403) -> validation (400) -> business rules (404/409).
Blocking PostgreSQL work runs in the thread pool so the event loop stays free.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from app import demo_session
from app.errors import ApiError, JsonUtf8Response
from app.reservations.service import ReservationService
from app.reservations.validation import (
    check_content_type,
    parse_confirm_request,
    parse_draft_id,
    parse_draft_request,
    parse_json_object,
)

router = APIRouter(prefix="/api/v1", tags=["reservations"])

NO_STORE = {"Cache-Control": "no-store"}


def _service(request: Request) -> ReservationService:
    service = request.app.state.reservation_service
    if service is None:
        raise ApiError(500, "INTERNAL_ERROR", "Chức năng đặt pin cần cơ sở dữ liệu PostgreSQL (DATABASE_URL).")
    return service


async def _session(request: Request, service: ReservationService) -> tuple:
    raw_sid = request.cookies.get(demo_session.SESSION_COOKIE)
    user_id = await run_in_threadpool(service.authenticate, raw_sid)
    return user_id, raw_sid


async def _json_write(request: Request, service: ReservationService, raw_sid: str) -> dict:
    body = await request.body()
    check_content_type(request.headers.get("content-type"), has_body=bool(body))
    service.check_csrf(raw_sid, request.headers.get(demo_session.CSRF_HEADER))
    return parse_json_object(body)


@router.post("/reservation-drafts", response_class=JsonUtf8Response, status_code=201)
async def create_draft(request: Request) -> JsonUtf8Response:
    """Prepare a draft for one battery. Holds no stock (BR-06, AE-09)."""
    service = _service(request)
    user_id, raw_sid = await _session(request, service)
    body = await _json_write(request, service, raw_sid)
    draft_request = parse_draft_request(body)
    draft = await run_in_threadpool(service.create_draft, user_id, draft_request)
    return JsonUtf8Response({"is_simulated": True, "draft": draft}, status_code=201, headers=NO_STORE)


@router.get("/reservation-drafts/{draft_id}", response_class=JsonUtf8Response)
async def get_draft(draft_id: str, request: Request) -> JsonUtf8Response:
    service = _service(request)
    user_id, _ = await _session(request, service)
    draft = await run_in_threadpool(service.get_draft, user_id, parse_draft_id(draft_id))
    return JsonUtf8Response({"is_simulated": True, "draft": draft}, headers=NO_STORE)


@router.post("/reservations", response_class=JsonUtf8Response, status_code=201)
async def confirm_reservation(request: Request) -> JsonUtf8Response:
    """Confirm a draft: hold exactly one battery atomically, or replay the original order."""
    service = _service(request)
    user_id, raw_sid = await _session(request, service)
    body = await _json_write(request, service, raw_sid)
    confirm_request = parse_confirm_request(request.headers.get("idempotency-key"), body)
    status, reservation = await run_in_threadpool(service.confirm, user_id, confirm_request)
    headers = dict(NO_STORE)
    if status == 201:
        headers["Location"] = f"/api/v1/reservations/{reservation['reservation_id']}"
    else:
        headers["Idempotent-Replayed"] = "true"
    return JsonUtf8Response({"is_simulated": True, "reservation": reservation}, status_code=status, headers=headers)
