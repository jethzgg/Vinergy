"""Regression tests for spike fixes on branch feat/1.3.2-llm-tool-spike.

Verifies:
- [P1] User coordinates (lat/lng) are stripped from tool messages sent to LLM provider (AD-05, NFR-04).
- [P2] Timeout in Google provider adapter and timeout fallback in orchestrator.
- [P2] Malformed parameter types from model (unhashable types, bool as float, inf/nan) return INVALID_INPUT, not 500.
- [P2] Rate limiting on POST /api/v1/spike/llm-chat returns 429 with Retry-After and error envelope.
"""

from __future__ import annotations

import copy
import math
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.llm.orchestrator import LLMOrchestrator, sanitize_tool_result_for_llm
from app.llm.providers.mock_provider import MockLLMProvider
from app.llm.providers.base import LLMResponse, ToolCall
from app.llm.tool_adapter import execute_tool
from app.llm.spike_router import rate_limiter
from app.core.config import get_settings


# ===========================================================================
# 1. Test [P1]: User coordinates are NOT sent to LLM provider
# ===========================================================================

class RecordingProvider(MockLLMProvider):
    """Provider that records all message histories it receives."""

    def __init__(self) -> None:
        super().__init__()
        self.received_histories: list[list[dict]] = []

    def send_message(self, *, messages, tools, system_prompt):
        # Save a snapshot of the messages received
        self.received_histories.append(copy.deepcopy(messages))
        return super().send_message(
            messages=messages, tools=tools, system_prompt=system_prompt
        )


def test_user_coordinates_stripped_from_llm_history():
    """Verify data.query.lat and lng are NEVER sent to the LLM (AD-05, NFR-04)."""
    provider = RecordingProvider()
    orchestrator = LLMOrchestrator(provider)

    context = {
        "location": {"lat": 21.0050, "lng": 105.8435},
        "family_code": "FAM_A",
    }

    result = orchestrator.handle(
        message="Tìm trạm đổi pin gần tôi",
        context=context,
    )

    # 1. The caller/app result MUST still have full coordinates
    assert result.tool_results
    app_tool_data = result.tool_results[0]["data"]
    assert "lat" in app_tool_data["query"]
    assert "lng" in app_tool_data["query"]
    assert app_tool_data["query"]["lat"] == 21.0050
    assert app_tool_data["query"]["lng"] == 105.8435

    # 2. In the second turn sent to the provider, data.query MUST NOT have lat/lng
    assert len(provider.received_histories) >= 2
    second_turn_messages = provider.received_histories[1]

    # Find the tool response message
    tool_messages = [m for m in second_turn_messages if m.get("role") == "tool"]
    assert len(tool_messages) >= 1
    llm_tool_content = tool_messages[0]["content"]

    assert "query" in llm_tool_content["data"]
    assert "lat" not in llm_tool_content["data"]["query"], "lat was leaked to LLM!"
    assert "lng" not in llm_tool_content["data"]["query"], "lng was leaked to LLM!"


def test_sanitize_tool_result_unit():
    raw_result = {
        "ok": True,
        "data": {
            "query": {
                "lat": 21.005,
                "lng": 105.8435,
                "service_type": "SWAPPING",
                "family_code": "FAM_A",
            },
            "total": 1,
            "stations": [],
        },
    }
    sanitized = sanitize_tool_result_for_llm(raw_result)
    assert "lat" not in sanitized["data"]["query"]
    assert "lng" not in sanitized["data"]["query"]
    assert sanitized["data"]["query"]["service_type"] == "SWAPPING"
    # Ensure original was not mutated
    assert "lat" in raw_result["data"]["query"]


# ===========================================================================
# 2. Test [P2]: Timeout & fallback handling
# ===========================================================================

def test_orchestrator_handles_timeout_finish_reason():
    """Verify orchestrator triggers MANUAL_FORM fallback on TIMEOUT."""
    class TimeoutProvider(MockLLMProvider):
        def send_message(self, **kwargs):
            return LLMResponse(
                text=None,
                finish_reason="TIMEOUT",
                raw="Request timed out after 15000ms",
            )

    orch = LLMOrchestrator(TimeoutProvider())
    result = orch.handle(
        message="Tìm trạm đổi pin",
        context={"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
    )
    assert result.fallback == "MANUAL_FORM"
    assert "sự cố" in result.reply.lower() or "thủ công" in result.reply.lower()


def test_google_genai_provider_timeout_config():
    """Verify GoogleGenAIProvider sets HttpOptions timeout."""
    from app.llm.providers.google_genai import GoogleGenAIProvider

    provider = GoogleGenAIProvider(
        api_key="fake-key-for-test",
        model="gemini-2.5-flash",
        timeout_ms=5000,
    )
    assert provider._timeout_ms == 5000
    assert provider._http_options.timeout == 5000


# ===========================================================================
# 3. Test [P2]: Malformed parameter types return INVALID_INPUT, not 500
# ===========================================================================

def test_unhashable_service_type_list():
    """Model returning service_type=[] must return INVALID_INPUT, not TypeError."""
    res = execute_tool(
        "search_stations",
        {"service_type": []},
        {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
    )
    assert res["ok"] is False
    assert res["error"]["code"] == "INVALID_INPUT"
    assert any(d["field"] == "service_type" for d in res["error"]["details"])


def test_unhashable_family_code_dict():
    """Model returning family_code={} must return INVALID_INPUT, not TypeError."""
    res = execute_tool(
        "search_stations",
        {"service_type": "SWAPPING", "family_code": {}},
        {"location": {"lat": 21.0, "lng": 105.0}},
    )
    assert res["ok"] is False
    assert res["error"]["code"] == "INVALID_INPUT"
    assert any(d["field"] == "family_code" for d in res["error"]["details"])


def test_radius_km_boolean_rejected():
    """Model returning radius_km=True must NOT be accepted as number 1."""
    res = execute_tool(
        "search_stations",
        {"service_type": "SWAPPING", "radius_km": True},
        {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
    )
    assert res["ok"] is False
    assert res["error"]["code"] == "INVALID_INPUT"
    assert any(d["field"] == "radius_km" and d["reason"] == "NOT_A_NUMBER" for d in res["error"]["details"])


def test_radius_km_inf_and_nan_rejected():
    """Model returning inf or nan for radius_km must return NOT_A_NUMBER."""
    for bad_val in (float("inf"), float("-inf"), float("nan")):
        res = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "radius_km": bad_val},
            {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
        )
        assert res["ok"] is False
        assert any(d["field"] == "radius_km" and d["reason"] == "NOT_A_NUMBER" for d in res["error"]["details"])


def test_tool_args_not_a_dict():
    """Model returning raw string or list for tool arguments."""
    res = execute_tool("search_stations", "invalid_arguments_string", {})
    assert res["ok"] is False
    assert res["error"]["code"] == "INVALID_INPUT"


# ===========================================================================
# 4. Test [P2]: Rate limiting per session & HTTP 503/504 error envelopes
# ===========================================================================

def test_rate_limiter_enforcement():
    """Verify the 11th consecutive request in a session gets 429 RATE_LIMITED with Retry-After."""
    client = TestClient(app)
    rate_limiter.reset()

    settings = get_settings()
    max_rpm = settings.llm_rate_limit_per_minute  # Default 10

    payload = {
        "message": "Tìm trạm đổi pin",
        "context": {
            "location": {"lat": 21.005, "lng": 105.8435},
            "family_code": "FAM_A",
        },
    }

    # First 10 requests under session-1 should succeed (200 OK)
    headers = {"X-Session-Id": "test-session-rate-limit"}
    for i in range(max_rpm):
        res = client.post("/api/v1/spike/llm-chat", json=payload, headers=headers)
        assert res.status_code == 200, f"Request {i+1} failed with {res.status_code}"

    # 11th request under the same session must return 429 Too Many Requests
    blocked_res = client.post("/api/v1/spike/llm-chat", json=payload, headers=headers)
    assert blocked_res.status_code == 429
    assert "Retry-After" in blocked_res.headers
    assert int(blocked_res.headers["Retry-After"]) >= 1

    body = blocked_res.json()
    assert body["error"]["code"] == "RATE_LIMITED"
    assert body["fallback"] == "MANUAL_FORM"
    assert "request_id" in body

    # Clean up rate limiter for other tests
    rate_limiter.reset()


def test_separate_sessions_on_same_ip_do_not_share_rate_limit():
    """Verify two users on the same IP (e.g. demo Wi-Fi) have independent quotas."""
    client = TestClient(app)
    rate_limiter.reset()

    settings = get_settings()
    max_rpm = settings.llm_rate_limit_per_minute

    payload = {
        "message": "Tìm trạm đổi pin",
        "context": {
            "location": {"lat": 21.005, "lng": 105.8435},
            "family_code": "FAM_A",
        },
    }

    # User A consumes all quota (10 requests)
    headers_a = {"X-Session-Id": "user-a-on-wifi"}
    for _ in range(max_rpm):
        res = client.post("/api/v1/spike/llm-chat", json=payload, headers=headers_a)
        assert res.status_code == 200

    # User A gets blocked on 11th call
    res_a_blocked = client.post("/api/v1/spike/llm-chat", json=payload, headers=headers_a)
    assert res_a_blocked.status_code == 429

    # User B on the EXACT same IP/client with their own session MUST still succeed (200 OK)
    headers_b = {"X-Session-Id": "user-b-on-same-wifi"}
    res_b = client.post("/api/v1/spike/llm-chat", json=payload, headers=headers_b)
    assert res_b.status_code == 200, "User B was wrongly rate-limited by User A's usage on the same IP!"

    rate_limiter.reset()


def test_endpoint_returns_503_on_upstream_unavailable(monkeypatch):
    """Verify endpoint returns HTTP 503 UPSTREAM_UNAVAILABLE with error envelope."""
    client = TestClient(app)

    class UnavailableProvider(MockLLMProvider):
        def send_message(self, **kwargs):
            raise ConnectionError("Connection refused to AI provider")

    monkeypatch.setattr("app.llm.spike_router._create_provider", lambda: UnavailableProvider())

    res = client.post(
        "/api/v1/spike/llm-chat",
        json={"message": "Tìm trạm đổi pin", "context": {}},
    )
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert body["fallback"] == "MANUAL_FORM"
    assert "request_id" in body


def test_endpoint_returns_504_on_upstream_timeout(monkeypatch):
    """Verify endpoint returns HTTP 504 UPSTREAM_TIMEOUT with error envelope."""
    client = TestClient(app)

    class TimeoutProvider(MockLLMProvider):
        def send_message(self, **kwargs):
            return LLMResponse(
                text=None,
                finish_reason="TIMEOUT",
                raw="Request timed out after 15000ms",
            )

    monkeypatch.setattr("app.llm.spike_router._create_provider", lambda: TimeoutProvider())

    res = client.post(
        "/api/v1/spike/llm-chat",
        json={"message": "Tìm trạm đổi pin", "context": {}},
    )
    assert res.status_code == 504
    body = res.json()
    assert body["error"]["code"] == "UPSTREAM_TIMEOUT"
    assert body["fallback"] == "MANUAL_FORM"
    assert "request_id" in body


def test_google_without_key_returns_manual_form(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", "google")
    monkeypatch.setattr(settings, "llm_api_key", "")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/spike/llm-chat", json={"message": "Tìm trạm"},
            headers={"X-Request-Id": "client-value"},
        )
        assert client.get("/health").status_code == 200

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert body["fallback"] == "MANUAL_FORM"
    assert body["request_id"] == response.headers["X-Request-Id"] != "client-value"
    assert "LLM_API_KEY" not in response.text


@pytest.mark.parametrize("failure", [TimeoutError(), ConnectionError("private diagnostic")])
def test_google_sdk_exception_maps_to_http_fallback(monkeypatch, failure):
    from types import SimpleNamespace

    from google import genai

    def generate_content(**kwargs):
        raise failure

    monkeypatch.setattr(
        genai, "Client",
        lambda **kwargs: SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)),
    )
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", "google")
    monkeypatch.setattr(settings, "llm_api_key", "fake-key")
    with TestClient(app) as client:
        response = client.post("/api/v1/spike/llm-chat", json={"message": "Tìm trạm"})

    expected = (504, "UPSTREAM_TIMEOUT") if isinstance(failure, TimeoutError) else (503, "UPSTREAM_UNAVAILABLE")
    assert (response.status_code, response.json()["error"]["code"]) == expected
    assert response.json()["fallback"] == "MANUAL_FORM"
    assert response.json()["request_id"] == response.headers["X-Request-Id"]
    assert "private diagnostic" not in response.text
