"""Automated tests for the LLM tool calling spike (Task 1.3.2).

Covers:
- Station stub service: Haversine, filtering, sorting, eligibility
- Tool adapter: allowlist, validation, context injection, error payloads
- Orchestrator: mock provider loop, latency tracking, error handling
- Spike endpoint: HTTP integration

Test categories mapped to acceptance examples:
- AE-20: Tool must not fabricate data
- AE-21: Provider error / timeout → graceful fallback
- FR-05: Tool calling with parameter validation
- NFR-06: Latency profiling
"""

from __future__ import annotations

import math
import pytest
from typing import Any

# ---------------------------------------------------------------------------
# 1. Station stub service tests
# ---------------------------------------------------------------------------

from app.services.station_stub import (
    haversine_km,
    search_stations,
    get_station_detail,
    _distance_display,
    _compute_eligibility,
    Station,
)


class TestHaversine:
    """Test Haversine distance calculation (api_contracts §1.1)."""

    def test_same_point_is_zero(self):
        assert haversine_km(21.005, 105.8435, 21.005, 105.8435) == 0.0

    def test_st01_to_st03(self):
        """AE-01 oracle: ST-01 → ST-03 ≈ 0.934066 km."""
        dist = haversine_km(21.005, 105.8435, 21.0115, 105.8492)
        assert abs(dist - 0.9340655580626385) < 1e-6

    def test_st01_to_st05(self):
        """AE-01 oracle: ST-01 → ST-05 ≈ 1.312928 km."""
        dist = haversine_km(21.005, 105.8435, 21.0032, 105.856)
        assert abs(dist - 1.3129277443639613) < 1e-6

    def test_st04_from_loc01(self):
        """AE-02 oracle: LOC-01 → ST-04 ≈ 1.284229 km."""
        dist = haversine_km(21.005, 105.8435, 21.0118, 105.8335)
        assert abs(dist - 1.284228856998922) < 1e-6


class TestDistanceDisplay:
    def test_zero(self):
        assert _distance_display(0.0) == "0.0 km"

    def test_half_up_rounding(self):
        assert _distance_display(0.9340655580626385) == "0.9 km"
        assert _distance_display(1.3129277443639613) == "1.3 km"
        assert _distance_display(1.653277827241357) == "1.7 km"


class TestEligibility:
    """Test booking_eligible algorithm (api_contracts §4.2)."""

    def _make_station(self, **overrides) -> Station:
        defaults = {
            "station_id": "ST-TEST",
            "name": "Test",
            "area_label": "Test area",
            "lat": 0.0, "lng": 0.0,
            "opening_status": "OPEN",
            "services": ["CHARGING", "SWAPPING"],
            "supported_families": ["FAM_A", "FAM_B"],
            "available_batteries_by_family": {"FAM_A": 5, "FAM_B": 3},
            "available_charging_ports_by_family": {"FAM_A": 2},
        }
        defaults.update(overrides)
        return Station(**defaults)

    def test_no_family_code(self):
        s = self._make_station()
        fs, be, ir = _compute_eligibility(s, None)
        assert (fs, be, ir) == (None, None, None)

    def test_charging_only(self):
        """ST-02: CHARGING only → CHARGING_ONLY."""
        s = self._make_station(services=["CHARGING"])
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (True, False, "CHARGING_ONLY")

    def test_unsupported_family(self):
        """ST-04: FAM_B only → UNSUPPORTED_FAMILY for FAM_A."""
        s = self._make_station(supported_families=["FAM_B"])
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (False, False, "UNSUPPORTED_FAMILY")

    def test_station_closed(self):
        s = self._make_station(opening_status="CLOSED")
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (True, False, "STATION_CLOSED")

    def test_station_maintenance(self):
        s = self._make_station(opening_status="MAINTENANCE")
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (True, False, "STATION_MAINTENANCE")

    def test_out_of_stock(self):
        """ST-05: FAM_A stock = 0 → OUT_OF_STOCK."""
        s = self._make_station(available_batteries_by_family={"FAM_A": 0, "FAM_B": 3})
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (True, False, "OUT_OF_STOCK")

    def test_eligible(self):
        """ST-01: all conditions met → eligible."""
        s = self._make_station()
        fs, be, ir = _compute_eligibility(s, "FAM_A")
        assert (fs, be, ir) == (True, True, None)


class TestSearchStations:
    """Integration tests for search_stations using seed data."""

    def test_ae01_search_swapping_fam_a_radius_2(self):
        """AE-01: Search SWAPPING FAM_A from LOC-01 within 2 km."""
        result = search_stations(
            lat=21.005, lng=105.8435,
            service_type="SWAPPING", family_code="FAM_A",
            radius_km=2,
        )
        assert result["is_simulated"] is True
        assert result["total"] == 4
        ids = [s["station_id"] for s in result["stations"]]
        assert ids == ["ST-01", "ST-03", "ST-05", "ST-06"]
        # ST-01 at distance 0.0
        assert result["stations"][0]["distance_km"] == 0.0
        assert result["stations"][0]["booking_eligible"] is True
        # ST-05 out of stock
        st05 = next(s for s in result["stations"] if s["station_id"] == "ST-05")
        assert st05["booking_eligible"] is False
        assert st05["ineligibility_reason"] == "OUT_OF_STOCK"

    def test_ae05_empty_result(self):
        """AE-05: Valid search with no results (LOC-03, tiny radius)."""
        result = search_stations(
            lat=21.2, lng=105.2,
            service_type="SWAPPING", family_code="FAM_A",
            radius_km=0.5,
        )
        assert result["total"] == 0
        assert result["stations"] == []

    def test_only_open_filter(self):
        """CLOSED/MAINTENANCE stations excluded when only_open=True."""
        result_open = search_stations(
            lat=21.005, lng=105.8435,
            service_type="SWAPPING", family_code="FAM_A",
            only_open=True,
        )
        result_all = search_stations(
            lat=21.005, lng=105.8435,
            service_type="SWAPPING", family_code="FAM_A",
            only_open=False,
        )
        open_ids = {s["station_id"] for s in result_open["stations"]}
        all_ids = {s["station_id"] for s in result_all["stations"]}
        # ST-09 is CLOSED, ST-13 is MAINTENANCE — should only appear in all
        assert "ST-09" not in open_ids
        assert "ST-09" in all_ids


class TestGetStationDetail:
    def test_existing_station(self):
        result = get_station_detail(
            station_id="ST-04",
            lat=21.005, lng=105.8435,
            family_code="FAM_A",
        )
        assert result is not None
        assert result["station"]["station_id"] == "ST-04"
        assert result["station"]["family_supported"] is False
        assert result["station"]["ineligibility_reason"] == "UNSUPPORTED_FAMILY"

    def test_nonexistent_station(self):
        result = get_station_detail(station_id="ST-99")
        assert result is None


# ---------------------------------------------------------------------------
# 2. Tool adapter tests
# ---------------------------------------------------------------------------

from app.llm.tool_adapter import execute_tool


class TestToolAdapterAllowlist:
    """AE-20: Only allowlisted tools may execute."""

    def test_unknown_tool_rejected(self):
        result = execute_tool("delete_all_data", {}, {})
        assert result["ok"] is False
        assert result["error"]["code"] == "TOOL_NOT_ALLOWED"

    def test_known_tool_accepted(self):
        result = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING"},
            {"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"},
        )
        assert result["ok"] is True


class TestToolAdapterValidation:
    """FR-05: Parameter validation on tool calls."""

    def test_missing_required_service_type(self):
        result = execute_tool("search_stations", {}, {"location": {"lat": 0, "lng": 0}})
        assert result["ok"] is False
        assert result["error"]["code"] == "INVALID_INPUT"
        fields = [d["field"] for d in result["error"]["details"]]
        assert "service_type" in fields

    def test_invalid_enum_value(self):
        result = execute_tool(
            "search_stations",
            {"service_type": "BOTH"},
            {"location": {"lat": 0, "lng": 0}, "family_code": "FAM_A"},
        )
        assert result["ok"] is False
        assert any(d["reason"] == "NOT_IN_ENUM" for d in result["error"]["details"])

    def test_negative_radius(self):
        result = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "radius_km": -5},
            {"location": {"lat": 0, "lng": 0}, "family_code": "FAM_A"},
        )
        assert result["ok"] is False
        assert any(d["reason"] == "NOT_POSITIVE" for d in result["error"]["details"])


class TestToolAdapterContextInjection:
    """AD-05, BR-10: Context injection rules."""

    def test_location_required(self):
        """AE-20: Missing location → LOCATION_REQUIRED, not hallucinated coords."""
        result = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING"},
            {},  # No location
        )
        assert result["ok"] is False
        assert result["error"]["code"] == "LOCATION_REQUIRED"

    def test_family_required(self):
        result = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING"},
            {"location": {"lat": 21.005, "lng": 105.8435}},  # No family_code
        )
        assert result["ok"] is False
        assert result["error"]["code"] == "FAMILY_REQUIRED"

    def test_llm_family_code_overrides_context(self):
        """LLM-explicit family_code takes priority over context (§5.2)."""
        result = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "family_code": "FAM_B"},
            {"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"},
        )
        assert result["ok"] is True
        assert result["data"]["query"]["family_code"] == "FAM_B"

    def test_station_not_found(self):
        result = execute_tool(
            "get_station_detail",
            {"station_id": "ST-99"},
            {},
        )
        assert result["ok"] is False
        assert result["error"]["code"] == "STATION_NOT_FOUND"


# ---------------------------------------------------------------------------
# 3. Orchestrator tests (with mock provider)
# ---------------------------------------------------------------------------

from app.llm.orchestrator import LLMOrchestrator
from app.llm.providers.mock_provider import MockLLMProvider


class TestOrchestrator:
    def _make_orchestrator(self) -> LLMOrchestrator:
        return LLMOrchestrator(MockLLMProvider())

    def _default_context(self) -> dict:
        return {
            "location": {"lat": 21.005, "lng": 105.8435},
            "family_code": "FAM_A",
        }

    def test_search_tool_call(self):
        """Mock provider calls search_stations for a search query."""
        orch = self._make_orchestrator()
        result = orch.handle(
            message="Tìm giúp tôi trạm đổi pin gần nhất",
            context=self._default_context(),
        )
        assert result.reply  # Non-empty reply
        assert len(result.tool_results) >= 1
        assert result.tool_results[0]["tool"] == "search_stations"
        assert result.tool_results[0]["ok"] is True
        assert result.fallback is None

    def test_detail_tool_call(self):
        """Mock provider calls get_station_detail for a detail query."""
        orch = self._make_orchestrator()
        result = orch.handle(
            message="Chi tiết trạm ST-04",
            context=self._default_context(),
        )
        assert len(result.tool_results) >= 1
        assert result.tool_results[0]["tool"] == "get_station_detail"

    def test_missing_context_handled(self):
        """Missing location → tool error → LLM asks for location."""
        orch = self._make_orchestrator()
        result = orch.handle(
            message="Tìm trạm đổi pin gần tôi",
            context={},  # No location, no family
        )
        assert len(result.tool_results) >= 1
        assert result.tool_results[0]["ok"] is False
        assert result.tool_results[0]["error"]["code"] == "LOCATION_REQUIRED"
        # LLM should respond asking for location
        assert "vị trí" in result.reply.lower() or "location" in result.reply.lower()

    def test_no_tool_call_for_unclear_message(self):
        """Non-search message → no tool call, text reply only."""
        orch = self._make_orchestrator()
        result = orch.handle(
            message="Xin chào",
            context=self._default_context(),
        )
        assert len(result.tool_results) == 0
        assert result.reply  # Non-empty

    def test_latency_metrics_present(self):
        """NFR-06: Metrics are tracked for every orchestration run."""
        orch = self._make_orchestrator()
        result = orch.handle(
            message="Tìm trạm đổi pin",
            context=self._default_context(),
        )
        m = result.metrics.summary()
        assert m["total_ms"] >= 0
        assert isinstance(m["llm_calls"], int)
        assert isinstance(m["tool_calls"], int)


class TestOrchestratorErrorHandling:
    """AE-21: Provider errors → graceful fallback."""

    def test_provider_exception(self):
        """Simulate a provider crash → fallback to MANUAL_FORM."""
        class CrashingProvider(MockLLMProvider):
            def send_message(self, **kwargs):
                raise ConnectionError("Simulated provider crash")

        orch = LLMOrchestrator(CrashingProvider())
        result = orch.handle(
            message="Tìm trạm đổi pin",
            context={"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"},
        )
        assert result.fallback == "MANUAL_FORM"
        assert "lỗi" in result.reply.lower() or "form" in result.reply.lower()

    def test_provider_returns_error(self):
        """Simulate a provider returning ERROR finish_reason."""
        from app.llm.providers.base import LLMResponse

        class ErrorProvider(MockLLMProvider):
            def send_message(self, **kwargs):
                return LLMResponse(text=None, finish_reason="ERROR", raw="rate_limited")

        orch = LLMOrchestrator(ErrorProvider())
        result = orch.handle(
            message="Tìm trạm đổi pin",
            context={"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"},
        )
        assert result.fallback == "MANUAL_FORM"


# ---------------------------------------------------------------------------
# 4. Spike endpoint HTTP tests
# ---------------------------------------------------------------------------

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestSpikeEndpoint:
    def test_health_still_works(self):
        response = client.get("/health")
        assert response.status_code == 200

    def test_spike_chat_search(self):
        response = client.post(
            "/api/v1/spike/llm-chat",
            json={
                "message": "Tìm giúp tôi trạm đổi pin gần nhất",
                "context": {
                    "location": {"lat": 21.005, "lng": 105.8435},
                    "family_code": "FAM_A",
                },
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["reply"]
        assert len(data["tool_results"]) >= 1
        assert data["tool_results"][0]["ok"] is True
        assert "metrics" in data

    def test_spike_chat_missing_context(self):
        response = client.post(
            "/api/v1/spike/llm-chat",
            json={
                "message": "Tìm trạm đổi pin",
                "context": {},
            },
        )
        assert response.status_code == 200
        data = response.json()
        # Should have tool error for missing location
        assert len(data["tool_results"]) >= 1
        assert data["tool_results"][0]["ok"] is False

    def test_spike_chat_empty_message_rejected(self):
        response = client.post(
            "/api/v1/spike/llm-chat",
            json={"message": "", "context": {}},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "INVALID_INPUT"
        assert response.json()["request_id"] == response.headers["X-Request-Id"]

    def test_spike_chat_no_tool_call(self):
        response = client.post(
            "/api/v1/spike/llm-chat",
            json={
                "message": "Xin chào, bạn là ai?",
                "context": {
                    "location": {"lat": 21.005, "lng": 105.8435},
                    "family_code": "FAM_A",
                },
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["reply"]
        assert len(data["tool_results"]) == 0
