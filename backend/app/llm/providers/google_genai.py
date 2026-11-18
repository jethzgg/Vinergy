"""Google Generative AI (Gemini) provider adapter.

Translates canonical tool schemas into google-genai function declarations
and handles the function-calling conversation loop.

Requires: google-genai >= 1.0.0
Environment: LLM_API_KEY must be set.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.llm.providers.base import BaseLLMProvider, LLMResponse, ToolCall

logger = logging.getLogger(__name__)


def _strip_unsupported_keywords(schema: dict) -> dict:
    """Remove JSON Schema keywords unsupported by the Gemini SDK.

    The canonical tool_schemas.json uses Draft 2020-12 keywords like
    `$schema`, `default`, `exclusiveMinimum`, and `additionalProperties`.
    The Gemini SDK does not support all of these.
    """
    unsupported = {"$schema", "default", "exclusiveMinimum", "additionalProperties"}
    cleaned: dict[str, Any] = {}
    for key, value in schema.items():
        if key in unsupported:
            continue
        if isinstance(value, dict):
            cleaned[key] = _strip_unsupported_keywords(value)
        elif isinstance(value, list):
            cleaned[key] = [
                _strip_unsupported_keywords(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            cleaned[key] = value
    return cleaned


class GoogleGenAIProvider(BaseLLMProvider):
    """Adapter for the google-genai SDK with function calling."""

    def __init__(self, *, api_key: str, model: str, timeout_ms: int = 15_000) -> None:
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise ImportError(
                "google-genai is required for the Google provider. "
                "Install with: pip install google-genai"
            ) from exc

        self._genai = genai
        self._types = types
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._timeout_ms = timeout_ms
        logger.info("GoogleGenAIProvider initialized (model=%s)", model)

    def _build_tools(self, tools: list[dict[str, Any]]) -> list:
        """Convert canonical tool specs to google-genai function declarations."""
        types = self._types
        declarations = []
        for tool in tools:
            params_schema = _strip_unsupported_keywords(tool.get("parameters", {}))
            declarations.append(
                types.FunctionDeclaration(
                    name=tool["name"],
                    description=tool["description"],
                    parameters=params_schema,
                )
            )
        return [types.Tool(function_declarations=declarations)]

    def _build_contents(self, messages: list[dict[str, Any]]) -> list:
        """Convert provider-agnostic messages to google-genai Content objects."""
        types = self._types
        contents = []
        for msg in messages:
            role = msg["role"]
            # Map roles: user → user, model → model, tool → user (function response)
            if role == "tool":
                # Function response
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part(
                                function_response=types.FunctionResponse(
                                    name=msg.get("tool_name", "unknown"),
                                    response=msg.get("content", {}),
                                )
                            )
                        ],
                    )
                )
            elif role == "model" and msg.get("tool_calls"):
                # Model turn that produced tool calls
                parts = []
                for tc in msg["tool_calls"]:
                    parts.append(
                        types.Part(
                            function_call=types.FunctionCall(
                                name=tc["name"],
                                args=tc["args"],
                            )
                        )
                    )
                if msg.get("content"):
                    parts.insert(0, types.Part(text=msg["content"]))
                contents.append(types.Content(role="model", parts=parts))
            else:
                genai_role = "model" if role == "model" else "user"
                content_text = msg.get("content", "")
                if isinstance(content_text, dict):
                    content_text = json.dumps(content_text, ensure_ascii=False)
                contents.append(
                    types.Content(
                        role=genai_role,
                        parts=[types.Part(text=content_text)],
                    )
                )
        return contents

    def send_message(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        """Send a turn to Gemini and parse the response."""
        types = self._types

        genai_tools = self._build_tools(tools)
        contents = self._build_contents(messages)

        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    tools=genai_tools,
                    temperature=0.1,
                ),
            )
        except Exception as exc:
            logger.error("Gemini API error: %s", exc)
            return LLMResponse(
                text=None,
                finish_reason="ERROR",
                raw=str(exc),
            )

        # Parse response
        candidate = response.candidates[0] if response.candidates else None
        if candidate is None:
            return LLMResponse(text="No response from model.", finish_reason="ERROR")

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []

        for part in candidate.content.parts:
            if part.function_call:
                fc = part.function_call
                tool_calls.append(ToolCall(
                    name=fc.name,
                    args=dict(fc.args) if fc.args else {},
                ))
            elif part.text:
                text_parts.append(part.text)

        finish_reason = "TOOL_CALL" if tool_calls else "STOP"
        text = "\n".join(text_parts) if text_parts else None

        return LLMResponse(
            text=text,
            tool_calls=tool_calls or None,
            finish_reason=finish_reason,
            raw=response,
        )
