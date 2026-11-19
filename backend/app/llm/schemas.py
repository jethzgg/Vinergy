"""Load and cache tool declarations from docs/architecture/tool_schemas.json.

Provides the canonical tool specs (name, description, parameter JSON Schema)
and a helper to convert them into provider-specific formats.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolSpec:
    """One canonical tool declaration."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolSchemaBundle:
    """All tool specs plus their result schemas."""

    tools: tuple[ToolSpec, ...]
    result_schemas: dict[str, Any]
    _tool_index: dict[str, ToolSpec] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        # Build lookup index (frozen dataclass workaround)
        idx = {t.name: t for t in self.tools}
        object.__setattr__(self, "_tool_index", idx)

    @property
    def tool_names(self) -> frozenset[str]:
        return frozenset(self._tool_index.keys())

    def get_tool(self, name: str) -> ToolSpec | None:
        return self._tool_index.get(name)


@lru_cache(maxsize=1)
def load_tool_schemas(path: str | None = None) -> ToolSchemaBundle:
    """Load and validate tool_schemas.json. Cached for the process lifetime."""
    schema_path = Path(path or get_settings().tool_schemas_path)
    logger.info("Loading tool schemas from %s", schema_path)

    with open(schema_path, encoding="utf-8") as f:
        raw = json.load(f)

    tools = tuple(
        ToolSpec(
            name=t["name"],
            description=t["description"],
            parameters=t["parameters"],
        )
        for t in raw["tools"]
    )

    bundle = ToolSchemaBundle(
        tools=tools,
        result_schemas=raw.get("result_schemas", {}),
    )
    logger.info("Loaded %d tool(s): %s", len(tools), bundle.tool_names)
    return bundle
