"""Spike LLM chat endpoint — POST /api/v1/spike/llm-chat.

This is a temporary endpoint for Task 1.3.2 to demonstrate tool calling.
It will be superseded by the full POST /api/v1/chat in Sprint 3.
"""

from __future__ import annotations

import hmac
import secrets
import time
import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from app.core.config import DEFAULT_SESSION_SECRET, get_settings
from app.llm.limits import InMemoryRateLimiter
from app.llm.orchestrator import LLMOrchestrator
from app.llm.providers.base import ProviderConfigurationError
from app.llm.providers.mock_provider import MockLLMProvider

router = APIRouter(prefix="/api/v1/spike", tags=["spike"])


rate_limiter = InMemoryRateLimiter()
_SESSION_COOKIE = "vinergy_spike_sid"
_SESSION_TTL = 8 * 60 * 60
_MOCK_SESSION_SECRET = secrets.token_bytes(32)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class LocationContext(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ChatContext(BaseModel):
    location: LocationContext | None = None
    family_code: str | None = Field(None, pattern=r"^(FAM_A|FAM_B)$")


class SpikeChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    context: ChatContext = ChatContext()


class SpikeChatResponse(BaseModel):
    reply: str
    tool_results: list[dict[str, Any]]
    fallback: str | None
    metrics: dict[str, Any]


# ---------------------------------------------------------------------------
# Provider factory
# ---------------------------------------------------------------------------

def _create_provider():
    """Create the LLM provider based on configuration."""
    settings = get_settings()
    provider_name = (settings.llm_provider or "mock").lower()

    if provider_name == "google":
        if settings.session_secret.strip() in ("", DEFAULT_SESSION_SECRET):
            raise ProviderConfigurationError("A dedicated SESSION_SECRET is required for Google spike sessions.")
        from app.llm.providers.google_genai import GoogleGenAIProvider
        return GoogleGenAIProvider(
            api_key=settings.llm_api_key,
            model=settings.llm_model or "gemini-2.5-flash",
            timeout_ms=settings.llm_timeout_ms,
        )
    else:
        # Default: deterministic mock
        return MockLLMProvider()


def _resolve_session_id(request: Request, configured_secret: str) -> tuple[str, str | None]:
    key = (configured_secret.encode() if configured_secret not in ("", DEFAULT_SESSION_SECRET)
           else _MOCK_SESSION_SECRET)
    token = request.cookies.get(_SESSION_COOKIE, "")
    payload, _, signature = token.rpartition(".")
    session_id, _, expires = payload.partition(".")
    now = int(time.time())
    if (
        len(session_id) == 32 and expires.isascii() and expires.isdecimal()
        and len(expires) <= 12 and int(expires) > now
        and len(signature) == 64 and signature.isascii()
        and hmac.compare_digest(hmac.digest(key, payload.encode(), "sha256").hex(), signature)
    ):
        return session_id, None

    session_id = uuid.uuid4().hex
    payload = f"{session_id}.{now + _SESSION_TTL}"
    signature = hmac.digest(key, payload.encode(), "sha256").hex()
    return session_id, f"{payload}.{signature}"


def _set_session_cookie(request: Request, response: Response, token: str | None) -> None:
    if token is not None:
        response.set_cookie(
            _SESSION_COOKIE, token, max_age=_SESSION_TTL, httponly=True,
            samesite="lax", secure=request.url.scheme == "https", path="/api/v1/spike",
        )


def _fallback_response(
    request: Request, status: int, code: str, message: str, *, retry_after: int | None = None, session_token: str | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or f"req_{uuid.uuid4().hex}"
    headers = {"X-Request-Id": request_id}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    response = JSONResponse(
        status_code=status,
        headers=headers,
        content={
            "error": {"code": code, "message": message, "details": []},
            "request_id": request_id,
            "fallback": "MANUAL_FORM",
        },
    )
    _set_session_cookie(request, response, session_token)
    return response


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/llm-chat", response_model=SpikeChatResponse)
def spike_llm_chat(req: SpikeChatRequest, request: Request, response: Response):
    """Spike endpoint to test LLM tool calling.

    Enforces session-based rate limits (LLM_RATE_LIMIT_PER_MINUTE) returning 429 RATE_LIMITED.
    Returns 503 UPSTREAM_UNAVAILABLE or 504 UPSTREAM_TIMEOUT if provider fails (AE-21, §2.2, §5.6).
    Accepts a user message and optional app context (location, family_code).
    Returns the LLM reply, tool execution results, fallback flag, and metrics.
    """
    try:
        settings = get_settings()
    except ValidationError:
        return _fallback_response(
            request, 503, "UPSTREAM_UNAVAILABLE", "Cấu hình LLM không hợp lệ.",
        )

    # Identify session (isolated per session, not per shared Wi-Fi IP)
    session_id, session_token = _resolve_session_id(request, settings.session_secret.strip())
    allowed, retry_after = rate_limiter.is_allowed(session_id, settings.llm_rate_limit_per_minute)
    if not allowed:
        return _fallback_response(
            request, 429, "RATE_LIMITED", "Quá giới hạn số lượt yêu cầu. Vui lòng thử lại sau.",
            retry_after=retry_after, session_token=session_token,
        )

    try:
        provider = _create_provider()
    except ProviderConfigurationError:
        return _fallback_response(
            request, 503, "UPSTREAM_UNAVAILABLE", "Nhà cung cấp LLM chưa được cấu hình.",
            session_token=session_token,
        )

    orchestrator = LLMOrchestrator(provider)

    context: dict[str, Any] = {}
    if req.context.location:
        context["location"] = {
            "lat": req.context.location.lat,
            "lng": req.context.location.lng,
        }
    if req.context.family_code:
        context["family_code"] = req.context.family_code

    result = orchestrator.handle(message=req.message, context=context)

    if result.retry_after is not None:
        return _fallback_response(
            request, 429, "RATE_LIMITED", result.reply,
            retry_after=result.retry_after, session_token=session_token,
        )
    if result.upstream_error:
        status = 504 if result.upstream_error == "UPSTREAM_TIMEOUT" else 503
        return _fallback_response(
            request, status, result.upstream_error,
            result.upstream_message or "Không nhận được phản hồi từ nhà cung cấp LLM.",
            session_token=session_token,
        )

    _set_session_cookie(request, response, session_token)

    return SpikeChatResponse(
        reply=result.reply,
        tool_results=result.tool_results,
        fallback=result.fallback,
        metrics=result.metrics.summary(),
    )
