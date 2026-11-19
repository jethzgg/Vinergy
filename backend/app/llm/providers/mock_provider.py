"""Mock LLM provider for deterministic testing and CI.

This provider simulates realistic function-calling behavior without
requiring any API key or network access. It pattern-matches on user
messages to produce appropriate tool calls or text responses.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.llm.providers.base import BaseLLMProvider, LLMResponse, ToolCall

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent detection (simple keyword-based for the spike)
# ---------------------------------------------------------------------------

_SEARCH_PATTERNS = [
    re.compile(r"(tìm|tìm giúp|search|find|look).*(trạm|station)", re.IGNORECASE),
    re.compile(r"(trạm|station).*(gần|near|close)", re.IGNORECASE),
    re.compile(r"(đổi pin|swap|swapping|sạc|charg)", re.IGNORECASE),
]

_DETAIL_PATTERNS = [
    re.compile(r"(chi tiết|detail|info|thông tin).*(ST-\d+)", re.IGNORECASE),
    re.compile(r"(ST-\d+).*(chi tiết|detail|info|thông tin)", re.IGNORECASE),
]

_STATION_ID_PATTERN = re.compile(r"(ST-\d+)", re.IGNORECASE)

_SERVICE_KEYWORDS = {
    "đổi pin": "SWAPPING",
    "swap": "SWAPPING",
    "swapping": "SWAPPING",
    "sạc": "CHARGING",
    "charg": "CHARGING",
    "charging": "CHARGING",
}

_FAMILY_KEYWORDS = {
    "fam_a": "FAM_A",
    "fam a": "FAM_A",
    "nhóm a": "FAM_A",
    "family a": "FAM_A",
    "fam_b": "FAM_B",
    "fam b": "FAM_B",
    "nhóm b": "FAM_B",
    "family b": "FAM_B",
}


def _extract_service_type(text: str) -> str | None:
    lower = text.lower()
    for keyword, service in _SERVICE_KEYWORDS.items():
        if keyword in lower:
            return service
    return None


def _extract_family_code(text: str) -> str | None:
    lower = text.lower()
    for keyword, family in _FAMILY_KEYWORDS.items():
        if keyword in lower:
            return family
    return None


class MockLLMProvider(BaseLLMProvider):
    """Deterministic mock that simulates LLM tool calling behavior."""

    def send_message(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        """Analyze the last user message and produce a mock response."""
        # Find the last user message
        user_msg = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_msg = msg.get("content", "")
                break

        # Find the last tool result (if orchestrator is feeding one back)
        last_tool_result = None
        for msg in reversed(messages):
            if msg.get("role") == "tool":
                last_tool_result = msg
                break

        # If we just received a tool result, synthesize a text reply
        if last_tool_result is not None and messages[-1].get("role") == "tool":
            return self._synthesize_from_tool_result(last_tool_result)

        # Check for detail intent
        for pattern in _DETAIL_PATTERNS:
            match = pattern.search(user_msg)
            if match:
                station_id_match = _STATION_ID_PATTERN.search(user_msg)
                if station_id_match:
                    station_id = station_id_match.group(1).upper()
                    args: dict[str, Any] = {"station_id": station_id}
                    fc = _extract_family_code(user_msg)
                    if fc:
                        args["family_code"] = fc
                    return LLMResponse(
                        tool_calls=[ToolCall(name="get_station_detail", args=args)],
                        finish_reason="TOOL_CALL",
                    )

        # Check for search intent
        for pattern in _SEARCH_PATTERNS:
            if pattern.search(user_msg):
                service_type = _extract_service_type(user_msg) or "SWAPPING"
                args = {"service_type": service_type}
                fc = _extract_family_code(user_msg)
                if fc:
                    args["family_code"] = fc
                return LLMResponse(
                    tool_calls=[ToolCall(name="search_stations", args=args)],
                    finish_reason="TOOL_CALL",
                )

        # No tool call needed — just respond with text
        return LLMResponse(
            text="Xin lỗi, tôi chưa hiểu yêu cầu. Bạn có thể nói rõ hơn được không? "
                 "Ví dụ: 'Tìm trạm đổi pin gần tôi' hoặc 'Chi tiết trạm ST-01'.",
            finish_reason="STOP",
        )

    def _synthesize_from_tool_result(self, tool_msg: dict[str, Any]) -> LLMResponse:
        """Generate a natural-language summary from a tool result."""
        content = tool_msg.get("content", {})
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                return LLMResponse(text="Đã nhận kết quả từ hệ thống.", finish_reason="STOP")

        if not content.get("ok", False):
            error = content.get("error", {})
            code = error.get("code", "UNKNOWN")
            message = error.get("message", "An error occurred.")
            if code == "LOCATION_REQUIRED":
                return LLMResponse(
                    text="Tôi cần biết vị trí của bạn để tìm trạm. Hãy chia sẻ vị trí trong ứng dụng.",
                    finish_reason="STOP",
                )
            if code == "FAMILY_REQUIRED":
                return LLMResponse(
                    text="Bạn đang sử dụng nhóm pin nào? (FAM_A hoặc FAM_B)",
                    finish_reason="STOP",
                )
            return LLMResponse(text=f"Có lỗi xảy ra: {message}", finish_reason="STOP")

        data = content.get("data", {})
        # search_stations result
        if "stations" in data:
            total = data.get("total", 0)
            if total == 0:
                return LLMResponse(
                    text="Không tìm thấy trạm nào phù hợp trong phạm vi tìm kiếm.",
                    finish_reason="STOP",
                )
            stations = data["stations"]
            lines = [f"Tìm thấy {total} trạm:"]
            for s in stations[:5]:  # Show top 5
                name = s["name"]
                dist = s.get("distance_display", "?")
                eligible = s.get("booking_eligible")
                stock_info = ""
                if eligible is True:
                    fc = data.get("query", {}).get("family_code")
                    if fc:
                        stock = s.get("available_batteries_by_family", {}).get(fc, 0)
                        stock_info = f", còn {stock} pin"
                elif eligible is False:
                    reason = s.get("ineligibility_reason", "")
                    stock_info = f", {reason}"
                lines.append(f"  - {name} ({dist}{stock_info})")
            return LLMResponse(text="\n".join(lines), finish_reason="STOP")

        # get_station_detail result
        if "station" in data:
            s = data["station"]
            name = s["name"]
            status = s.get("opening_status", "?")
            dist = s.get("distance_display")
            dist_str = f" — cách {dist}" if dist else ""
            return LLMResponse(
                text=f"{name}{dist_str} — Trạng thái: {status}",
                finish_reason="STOP",
            )

        return LLMResponse(text="Đã nhận kết quả.", finish_reason="STOP")
