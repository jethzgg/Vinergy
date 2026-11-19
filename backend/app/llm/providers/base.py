"""Abstract base for LLM provider adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from httpx import TimeoutException


class ProviderConfigurationError(Exception):
    """The selected provider cannot start with the current settings."""


def is_transport_timeout(exc: Exception) -> bool:
    return isinstance(exc, (TimeoutError, TimeoutException))


@dataclass
class ToolCall:
    """A tool call extracted from the model's response."""
    name: str
    args: dict[str, Any]


@dataclass
class LLMResponse:
    """Unified response from any provider adapter."""
    text: str | None = None          # Natural-language reply (if any)
    tool_calls: list[ToolCall] | None = None  # Tool calls to execute (if any)
    finish_reason: str = "STOP"      # STOP | TOOL_CALL | MAX_TOKENS | ERROR
    raw: Any = None                  # Provider-specific raw response for debugging


class BaseLLMProvider(ABC):
    """Interface that every LLM provider adapter must implement."""

    @abstractmethod
    def send_message(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        """Send a conversation turn to the provider and return the response.

        Args:
            messages: Conversation history in a provider-agnostic format:
                [{"role": "user"|"model"|"tool", "content": str|dict, ...}, ...]
            tools: Tool declarations in provider-agnostic format.
            system_prompt: System-level instructions.

        Returns:
            Unified LLMResponse with text and/or tool_calls.
        """
        ...
