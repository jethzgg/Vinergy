"""Spike LLM chat endpoint — POST /api/v1/spike/llm-chat.

This is a temporary endpoint for Task 1.3.2 to demonstrate tool calling.
It will be superseded by the full POST /api/v1/chat in Sprint 3.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.llm.orchestrator import LLMOrchestrator
from app.llm.providers.mock_provider import MockLLMProvider

router = APIRouter(prefix="/api/v1/spike", tags=["spike"])


# ---------------------------------------------------------------------------
# In-memory Rate Limiter (api_contracts §2.2, §5.5)
# ---------------------------------------------------------------------------

class InMemoryRateLimiter:
    """Sliding-window rate limiter per client key."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, list[float]] = {}

    def is_allowed(
        self, client_key: str, max_requests: int, window_seconds: float = 60.0
    ) -> tuple[bool, int]:
        """Check if request is allowed. Returns (allowed, retry_after_seconds)."""
        now = time.time()
        with self._lock:
            history = self._requests.setdefault(client_key, [])
            cutoff = now - window_seconds
            history = [ts for ts in history if ts > cutoff]
            self._requests[client_key] = history

            if len(history) >= max_requests:
                oldest = history[0]
                retry_after = max(1, int(window_seconds - (now - oldest)) + 1)
                return False, retry_after

            history.append(now)
            return True, 0

    def reset(self) -> None:
        """Reset rate limiter state (useful for test isolation)."""
        with self._lock:
            self._requests.clear()


rate_limiter = InMemoryRateLimiter()


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

class ProviderConfigurationError(Exception):
    """The selected provider cannot start with the current settings."""


def _create_provider():
    """Create the LLM provider based on configuration."""
    settings = get_settings()
    provider_name = (settings.llm_provider or "mock").lower()

    if provider_name == "google":
        if not settings.llm_api_key.strip():
            raise ProviderConfigurationError("LLM_API_KEY is required for the Google provider.")
        from app.llm.providers.google_genai import GoogleGenAIProvider
        return GoogleGenAIProvider(
            api_key=settings.llm_api_key,
            model=settings.llm_model or "gemini-2.5-flash",
            timeout_ms=settings.llm_timeout_ms,
        )
    else:
        # Default: deterministic mock
        return MockLLMProvider()


def _resolve_session_id(request: Request) -> tuple[str, bool]:
    """Resolve session identifier for rate limiting (api_contracts §2.2, §3, §5.5).

    Resolves:
    1. Cookie `vinergy_sid` (canonical session cookie)
    2. Header `X-Session-Id` or `Session-Id`
    3. If neither is present, generates a fresh unique session id and sets cookie,
       ensuring separate clients on the same Wi-Fi IP don't share rate limits.

    Returns:
        (session_id, is_new_session)
    """
    sid = request.cookies.get("vinergy_sid")
    if sid:
        return sid, False

    header_sid = request.headers.get("X-Session-Id") or request.headers.get("Session-Id")
    if header_sid:
        return header_sid, False

    new_sid = f"sid_{uuid.uuid4().hex}"
    return new_sid, True


def _fallback_response(
    request: Request, status: int, code: str, message: str, *, retry_after: int | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or f"req_{uuid.uuid4().hex}"
    headers = {"X-Request-Id": request_id}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=status,
        headers=headers,
        content={
            "error": {"code": code, "message": message, "details": []},
            "request_id": request_id,
            "fallback": "MANUAL_FORM",
        },
    )


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
    settings = get_settings()
    max_rpm = settings.llm_rate_limit_per_minute

    # Identify session (isolated per session, not per shared Wi-Fi IP)
    session_id, is_new_session = _resolve_session_id(request)
    allowed, retry_after = rate_limiter.is_allowed(
        session_id, max_requests=max_rpm, window_seconds=60.0
    )
    if not allowed:
        return _fallback_response(
            request, 429, "RATE_LIMITED", "Quá giới hạn số lượt yêu cầu. Vui lòng thử lại sau.",
            retry_after=retry_after,
        )

    try:
        provider = _create_provider()
    except ProviderConfigurationError:
        unavailable = _fallback_response(
            request, 503, "UPSTREAM_UNAVAILABLE", "Nhà cung cấp LLM chưa được cấu hình.",
        )
        if is_new_session:
            unavailable.set_cookie("vinergy_sid", session_id, httponly=True, samesite="lax", path="/")
        return unavailable

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

    if result.upstream_error:
        status = 504 if result.upstream_error == "UPSTREAM_TIMEOUT" else 503
        error = _fallback_response(
            request, status, result.upstream_error,
            result.upstream_message or "Không nhận được phản hồi từ nhà cung cấp LLM.",
        )
        if is_new_session:
            error.set_cookie("vinergy_sid", session_id, httponly=True, samesite="lax", path="/")
        return error

    if is_new_session:
        response.set_cookie("vinergy_sid", session_id, httponly=True, samesite="lax", path="/")

    return SpikeChatResponse(
        reply=result.reply,
        tool_results=result.tool_results,
        fallback=result.fallback,
        metrics=result.metrics.summary(),
    )
