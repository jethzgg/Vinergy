"""Error envelope, X-Request-Id and exception handlers (api_contracts §1, §2)."""

from __future__ import annotations

import logging
import secrets
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("vinergy")

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class JsonUtf8Response(JSONResponse):
    media_type = "application/json; charset=utf-8"


def new_request_id() -> str:
    """ULID-shaped id: 48-bit ms timestamp + 80 random bits, Crockford base32."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[value & 31])
        value >>= 5
    return "req_" + "".join(reversed(chars))


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list | None = None,
        headers: dict | None = None,
    ):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []
        self.headers = headers or {}

    @classmethod
    def invalid_input(cls, details: list) -> "ApiError":
        return cls(400, "INVALID_INPUT", "Một hoặc nhiều tham số không hợp lệ.", details)

    @classmethod
    def station_not_found(cls) -> "ApiError":
        return cls(404, "STATION_NOT_FOUND", "Không tìm thấy trạm.")


def error_response(
    request: Request,
    status: int,
    code: str,
    message: str,
    details: list,
    headers: dict | None = None,
) -> JsonUtf8Response:
    request_id = getattr(request.state, "request_id", None) or new_request_id()
    return JsonUtf8Response(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "details": details},
            "request_id": request_id,
        },
        headers={**(headers or {}), "X-Request-Id": request_id},
    )


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request.state.request_id = new_request_id()
        try:
            response = await call_next(request)
        except Exception:  # never leak stack traces (§2.1)
            logger.exception("Unhandled error (request_id=%s)", request.state.request_id)
            response = error_response(request, 500, "INTERNAL_ERROR", "Đã xảy ra lỗi máy chủ.", [])
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return error_response(request, exc.status, exc.code, exc.message, exc.details, exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException):
        # Unknown path and unknown method both map to ROUTE_NOT_FOUND (§2.2).
        if exc.status_code in (404, 405):
            return error_response(request, 404, "ROUTE_NOT_FOUND", "Không tìm thấy đường dẫn.", [])
        return error_response(request, 500, "INTERNAL_ERROR", "Đã xảy ra lỗi máy chủ.", [])

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        return error_response(request, 400, "INVALID_INPUT", "Một hoặc nhiều tham số không hợp lệ.", [])
