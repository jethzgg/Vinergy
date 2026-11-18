"""Application configuration loaded from environment variables (NFR-03, AE-23a).

Secrets are never logged or exposed. The `.env` file is loaded automatically
by pydantic-settings when present but must NEVER be committed to Git.
"""

from __future__ import annotations

import logging
from pathlib import Path
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Resolve project root (two levels up from this file → backend/app/core → repo root)
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Typed, validated application settings."""

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- General ---
    app_env: Literal["development", "test", "demo"] = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000

    # --- Database ---
    database_path: str = "data/vinergy_dev.db"

    # --- Session ---
    session_secret: str = "change-me-local-dev-only"

    # --- LLM Provider (server-side only) ---
    llm_provider: str = ""          # e.g. "google", "openai", "mock"
    llm_model: str = ""             # e.g. "gemini-2.5-flash"
    llm_api_key: str = ""           # NEVER log this value

    # --- LLM Orchestrator limits ---
    llm_timeout_ms: int = 15_000
    llm_max_tool_rounds: int = 3
    llm_rate_limit_per_minute: int = 10

    # --- Seed data ---
    seed_stations_path: str = str(_PROJECT_ROOT / "data" / "seed_stations_v0.json")

    # --- Tool schemas ---
    tool_schemas_path: str = str(
        _PROJECT_ROOT / "docs" / "architecture" / "tool_schemas.json"
    )

    def log_safe_summary(self) -> dict:
        """Return a dict safe for logging — secrets are masked."""
        return {
            "app_env": self.app_env,
            "llm_provider": self.llm_provider or "(not set)",
            "llm_model": self.llm_model or "(not set)",
            "llm_api_key": "***" if self.llm_api_key else "(not set)",
            "llm_timeout_ms": self.llm_timeout_ms,
            "llm_max_tool_rounds": self.llm_max_tool_rounds,
            "llm_rate_limit_per_minute": self.llm_rate_limit_per_minute,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — parsed once, cached for the process lifetime."""
    settings = Settings()
    logger.info("Settings loaded: %s", settings.log_safe_summary())
    return settings
