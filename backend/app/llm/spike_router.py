"""Spike LLM chat endpoint — POST /api/v1/spike/llm-chat.

This is a temporary endpoint for Task 1.3.2 to demonstrate tool calling.
It will be superseded by the full POST /api/v1/chat in Sprint 3.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any

from app.core.config import get_settings
from app.llm.orchestrator import LLMOrchestrator
from app.llm.providers.mock_provider import MockLLMProvider

router = APIRouter(prefix="/api/v1/spike", tags=["spike"])


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
        if not settings.llm_api_key:
            raise ValueError("LLM_API_KEY is required for the Google provider.")
        from app.llm.providers.google_genai import GoogleGenAIProvider
        return GoogleGenAIProvider(
            api_key=settings.llm_api_key,
            model=settings.llm_model or "gemini-2.5-flash",
            timeout_ms=settings.llm_timeout_ms,
        )
    else:
        # Default: deterministic mock
        return MockLLMProvider()


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/llm-chat", response_model=SpikeChatResponse)
def spike_llm_chat(req: SpikeChatRequest) -> SpikeChatResponse:
    """Spike endpoint to test LLM tool calling.

    Accepts a user message and optional app context (location, family_code).
    Returns the LLM reply, tool execution results, fallback flag, and metrics.
    """
    provider = _create_provider()
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

    return SpikeChatResponse(
        reply=result.reply,
        tool_results=result.tool_results,
        fallback=result.fallback,
        metrics=result.metrics.summary(),
    )
