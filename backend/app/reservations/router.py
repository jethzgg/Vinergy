"""HTTP adapter for reservation drafts and confirmation (api_contracts §6.1, §6.4, §6.5, §6.7).

Checks run in the fixed order of §1.3: route -> session (401) -> Content-Type (415)
-> X-CSRF-Token (403) -> validation (400) -> business rules (404/409).
Blocking PostgreSQL work runs in the thread pool so the event loop stays free.
Every response of these routes, errors included, carries Cache-Control: no-store (§6):
the answer depends on the session, so a cached 404 or draft must never be reused.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import demo_session
from app.errors import ApiError, JsonUtf8Response, error_response
from app.reservations.service import ReservationService
from app.reservations.validation import (
    check_content_type,
    parse_confirm_request,
    parse_draft_id,
    parse_draft_request,
    parse_json_object,
)

NO_STORE = {"Cache-Control": "no-store"}

logger = logging.getLogger("vinergy")


class NoStoreRoute(APIRoute):
    """Adds no-store to success responses, ApiError responses and unexpected 500s alike."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def no_store_handler(request: Request):
            try:
                response = await handler(request)
            except ApiError as exc:
                exc.headers = {**exc.headers, **NO_STORE}
                raise
            except (StarletteHTTPException, RequestValidationError):
                raise  # framework errors keep their own handlers (§2.2)
            except Exception:  # same envelope as the global middleware, plus no-store
                logger.exception("Unhandled error (request_id=%s)", getattr(request.state, "request_id", None))
                return error_response(request, 500, "INTERNAL_ERROR", "Đã xảy ra lỗi máy chủ.", [], NO_STORE)
            response.headers.update(NO_STORE)
            return response

        return no_store_handler


router = APIRouter(prefix="/api/v1", tags=["reservations"], route_class=NoStoreRoute)


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
    draft_request = parse_draft_request(body, request.query_params.keys())
    draft = await run_in_threadpool(service.create_draft, user_id, draft_request)
    return JsonUtf8Response({"is_simulated": True, "draft": draft}, status_code=201)


@router.get("/reservation-drafts/{draft_id}", response_class=JsonUtf8Response)
async def get_draft(draft_id: str, request: Request) -> JsonUtf8Response:
    service = _service(request)
    user_id, _ = await _session(request, service)
    draft_id = parse_draft_id(draft_id, request.query_params.keys())
    draft = await run_in_threadpool(service.get_draft, user_id, draft_id)
    return JsonUtf8Response({"is_simulated": True, "draft": draft})


@router.post("/reservations", response_class=JsonUtf8Response, status_code=201)
async def confirm_reservation(request: Request) -> JsonUtf8Response:
    """Confirm a draft: hold exactly one battery atomically, or replay the original order."""
    service = _service(request)
    user_id, raw_sid = await _session(request, service)
    body = await _json_write(request, service, raw_sid)
    confirm_request = parse_confirm_request(
        request.headers.get("idempotency-key"), body, request.query_params.keys()
    )
    status, reservation = await run_in_threadpool(service.confirm, user_id, confirm_request)
    headers = {}
    if status == 201:
        headers["Location"] = f"/api/v1/reservations/{reservation['reservation_id']}"
    else:
        headers["Idempotent-Replayed"] = "true"
    return JsonUtf8Response({"is_simulated": True, "reservation": reservation}, status_code=status, headers=headers)
