"""Tool Adapter — validates tool calls and dispatches to the Station Service.

Responsibilities (architecture.md §3, api_contracts §5):
- Allowlist enforcement: only tools declared in tool_schemas.json are executed.
- Parameter re-validation using the same rules as the HTTP layer (AD-06).
- Context injection: lat/lng and family_code come from the trusted app context,
  NEVER from LLM-provided parameters (AD-05, BR-10, AE-20).
- Returns canonical ToolResult payloads ({ok, data} or {ok, error}).
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any

from app.llm.schemas import load_tool_schemas
from app.services.station_stub import search_stations, get_station_detail

logger = logging.getLogger(__name__)

# Valid enum values for validation
_SERVICE_TYPES = {"CHARGING", "SWAPPING"}
_FAMILY_CODES = {"FAM_A", "FAM_B"}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _make_error(code: str, message: str, details: list[dict] | None = None) -> dict:
    """Build a canonical ToolError envelope."""
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or [],
        },
    }


def _make_detail(field: str, reason: str, message: str) -> dict:
    return {"field": field, "reason": reason, "message": message}


def _validate_search_params(args: dict[str, Any]) -> list[dict]:
    """Validate search_stations tool parameters. Returns list of error details."""
    errors: list[dict] = []

    # service_type — required, enum string
    st = args.get("service_type")
    if st is None:
        errors.append(_make_detail("service_type", "REQUIRED", "service_type is required."))
    elif not isinstance(st, str):
        errors.append(_make_detail("service_type", "INVALID_FORMAT", "service_type must be a string."))
    elif st not in _SERVICE_TYPES:
        errors.append(_make_detail("service_type", "NOT_IN_ENUM", f"service_type must be one of {sorted(_SERVICE_TYPES)}."))

    # family_code — optional, enum string (may come from context)
    fc = args.get("family_code")
    if fc is not None:
        if not isinstance(fc, str):
            errors.append(_make_detail("family_code", "INVALID_FORMAT", "family_code must be a string."))
        elif fc not in _FAMILY_CODES:
            errors.append(_make_detail("family_code", "NOT_IN_ENUM", f"family_code must be one of {sorted(_FAMILY_CODES)}."))

    # only_open — optional, boolean
    oo = args.get("only_open")
    if oo is not None and not isinstance(oo, bool):
        errors.append(_make_detail("only_open", "NOT_BOOLEAN", "only_open must be a boolean."))

    # radius_km — optional, positive finite number (strictly not boolean)
    rk = args.get("radius_km")
    if rk is not None:
        if isinstance(rk, bool) or not isinstance(rk, (int, float)) or not math.isfinite(rk):
            errors.append(_make_detail("radius_km", "NOT_A_NUMBER", "radius_km must be a finite number."))
        elif rk <= 0:
            errors.append(_make_detail("radius_km", "NOT_POSITIVE", "radius_km must be greater than 0."))

    # Reject unknown parameters
    known = {"service_type", "family_code", "only_open", "radius_km"}
    for key in args:
        if key not in known:
            errors.append(_make_detail(key, "UNKNOWN_PARAM", f"Unknown parameter: {key}"))

    return errors


def _validate_detail_params(args: dict[str, Any]) -> list[dict]:
    """Validate get_station_detail tool parameters."""
    errors: list[dict] = []

    sid = args.get("station_id")
    if sid is None:
        errors.append(_make_detail("station_id", "REQUIRED", "station_id is required."))
    elif not isinstance(sid, str) or not re.match(r"^[A-Z0-9-]{1,32}$", sid):
        errors.append(_make_detail("station_id", "INVALID_FORMAT", "station_id must be a string matching ^[A-Z0-9-]{1,32}$."))

    fc = args.get("family_code")
    if fc is not None:
        if not isinstance(fc, str):
            errors.append(_make_detail("family_code", "INVALID_FORMAT", "family_code must be a string."))
        elif fc not in _FAMILY_CODES:
            errors.append(_make_detail("family_code", "NOT_IN_ENUM", f"family_code must be one of {sorted(_FAMILY_CODES)}."))

    known = {"station_id", "family_code"}
    for key in args:
        if key not in known:
            errors.append(_make_detail(key, "UNKNOWN_PARAM", f"Unknown parameter: {key}"))

    return errors


# ---------------------------------------------------------------------------
# Public dispatch
# ---------------------------------------------------------------------------

def execute_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    """Validate, inject context, and dispatch a tool call.

    Args:
        tool_name: The name the LLM requested (must be in allowlist).
        tool_args: Parameters extracted by the LLM.
        context: Trusted app context with optional keys:
            - location: {"lat": float, "lng": float} | None
            - family_code: str | None

    Returns:
        Canonical ToolResult dict: {"ok": True, "data": ...} or {"ok": False, "error": ...}
    """
    schemas = load_tool_schemas()

    # 1. Allowlist check (§5.1 rule 1)
    if schemas.get_tool(tool_name) is None:
        logger.warning("Tool not in allowlist: %s", tool_name)
        return _make_error(
            "TOOL_NOT_ALLOWED",
            f"Tool '{tool_name}' is not in the allowed tool list.",
        )

    # 1b. Check argument container type
    if not isinstance(tool_args, dict):
        return _make_error(
            "INVALID_INPUT",
            "Tool arguments must be a JSON object.",
            [_make_detail("parameters", "INVALID_FORMAT", "Expected a dictionary of parameters.")],
        )

    # 2. Dispatch by tool name
    if tool_name == "search_stations":
        return _execute_search(tool_args, context)
    elif tool_name == "get_station_detail":
        return _execute_detail(tool_args, context)
    else:
        # Schema lists it but we have no handler — defensive guard
        return _make_error("INTERNAL_ERROR", f"No handler for tool '{tool_name}'.")


def _execute_search(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Handle search_stations tool call."""
    # Validate parameters
    errors = _validate_search_params(args)
    if errors:
        return _make_error("INVALID_INPUT", "One or more parameters are invalid.", errors)

    # Context injection: location (AD-05)
    location = context.get("location")
    if location is None:
        details = [_make_detail("location", "REQUIRED", "App location is not available.")]
        # Also flag family_code if missing (§5.2)
        fc = args.get("family_code") or context.get("family_code")
        if fc is None:
            details.append(_make_detail("family_code", "REQUIRED", "Battery family is not determined."))
        return _make_error(
            "LOCATION_REQUIRED",
            "Location is required. Ask the user to share or select their location in the app.",
            details,
        )

    lat = location["lat"]
    lng = location["lng"]

    # Context injection: family_code — LLM explicit > context default (§5.2)
    family_code = args.get("family_code") or context.get("family_code")
    if family_code is None:
        return _make_error(
            "FAMILY_REQUIRED",
            "Battery family is required. Ask the user which battery family they have.",
            [_make_detail("family_code", "REQUIRED", "Battery family is not determined.")],
        )

    # Execute
    data = search_stations(
        lat=lat,
        lng=lng,
        service_type=args["service_type"],
        family_code=family_code,
        only_open=args.get("only_open", True),
        radius_km=args.get("radius_km"),
    )

    return {"ok": True, "data": data}


def _execute_detail(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Handle get_station_detail tool call."""
    errors = _validate_detail_params(args)
    if errors:
        return _make_error("INVALID_INPUT", "One or more parameters are invalid.", errors)

    # Context injection
    location = context.get("location")
    lat = location["lat"] if location else None
    lng = location["lng"] if location else None
    family_code = args.get("family_code") or context.get("family_code")

    result = get_station_detail(
        station_id=args["station_id"],
        lat=lat,
        lng=lng,
        family_code=family_code,
    )

    if result is None:
        return _make_error(
            "STATION_NOT_FOUND",
            f"Station '{args['station_id']}' does not exist.",
        )

    return {"ok": True, "data": result}
