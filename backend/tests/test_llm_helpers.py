"""Unit tests for google_genai helper functions and adapter edge cases."""

from __future__ import annotations

import pytest
from app.llm.providers.google_genai import _strip_unsupported_keywords
from app.llm.tool_adapter import execute_tool


class TestGoogleGenAIHelpers:
    def test_strip_unsupported_keywords(self):
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "service_type": {
                    "type": "string",
                    "default": "SWAPPING",
                },
                "radius_km": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                },
                "nested": {
                    "type": "array",
                    "items": {
                        "default": "val",
                        "name": "item",
                    },
                },
            },
        }

        cleaned = _strip_unsupported_keywords(schema)
        assert "$schema" not in cleaned
        assert "additionalProperties" not in cleaned
        assert "default" not in cleaned["properties"]["service_type"]
        assert "exclusiveMinimum" not in cleaned["properties"]["radius_km"]
        assert "default" not in cleaned["properties"]["nested"]["items"]
        assert cleaned["properties"]["nested"]["items"]["name"] == "item"


class TestToolAdapterEdgeCases:
    def test_invalid_param_types(self):
        # only_open not a bool
        res = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "only_open": "yes"},
            {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
        )
        assert res["ok"] is False
        assert any(d["reason"] == "NOT_BOOLEAN" for d in res["error"]["details"])

        # radius_km not a number
        res2 = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "radius_km": "far"},
            {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
        )
        assert res2["ok"] is False
        assert any(d["reason"] == "NOT_A_NUMBER" for d in res2["error"]["details"])

        # unknown param in search
        res3 = execute_tool(
            "search_stations",
            {"service_type": "SWAPPING", "extra_param": 123},
            {"location": {"lat": 21.0, "lng": 105.0}, "family_code": "FAM_A"},
        )
        assert res3["ok"] is False
        assert any(d["reason"] == "UNKNOWN_PARAM" for d in res3["error"]["details"])

        # invalid station_id type in get_station_detail
        res4 = execute_tool(
            "get_station_detail",
            {"station_id": 12345},
            {},
        )
        assert res4["ok"] is False
        assert any(d["reason"] == "INVALID_FORMAT" for d in res4["error"]["details"])

        # invalid family_code in get_station_detail
        res5 = execute_tool(
            "get_station_detail",
            {"station_id": "ST-01", "family_code": "INVALID"},
            {},
        )
        assert res5["ok"] is False
        assert any(d["reason"] == "NOT_IN_ENUM" for d in res5["error"]["details"])

        # unknown param in detail
        res6 = execute_tool(
            "get_station_detail",
            {"station_id": "ST-01", "unknown_foo": "bar"},
            {},
        )
        assert res6["ok"] is False
        assert any(d["reason"] == "UNKNOWN_PARAM" for d in res6["error"]["details"])
