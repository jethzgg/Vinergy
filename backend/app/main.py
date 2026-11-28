"""Vinergy FastAPI app: health check (1.3.1) and station search/detail (Sprint 1)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import errors
from app.core.config import get_settings
from app.llm.spike_router import router as spike_router
from app.reservations.config import ReservationSettings
from app.reservations.router import router as reservations_router
from app.reservations.service import ReservationService
from app.stations.repository import postgres_repository, sqlite_repository
from app.stations.router import router as stations_router
from app.stations.service import StationService

# Secrets live in the repo-root .env (never committed, see .env.example). Real env vars win.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

app = FastAPI(
    title="Vinergy API",
    version="0.1.0",
    description="Academic demo API for charging/swapping station discovery and battery reservation.",
    # A trailing slash is a different (unknown) route, not a 307 redirect.
    redirect_slashes=False,
)

errors.install(app)


def _station_repository():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return postgres_repository(database_url)
    logging.getLogger("vinergy").warning(
        "DATABASE_URL is not set: serving stations from an in-memory SQLite copy of db/seed.sql."
    )
    return sqlite_repository()


def _reservation_service():
    """Reservations need PostgreSQL (row locks, advisory locks). Without it the endpoints answer 500.

    With DATABASE_URL set, startup fails with SessionSecretError when SESSION_SECRET is
    empty or the public sample value: the service never runs with a known session key.
    """
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return None
    return ReservationService(database_url, ReservationSettings.from_env(), get_settings().session_secret)


# Tests can swap these services (see tests/conftest.py, tests/test_reservations_postgres.py).
app.state.station_service = StationService(_station_repository())
app.state.reservation_service = _reservation_service()
app.include_router(stations_router)
app.include_router(reservations_router)
app.include_router(spike_router)

allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # The reservation client reads these on cross-origin responses (api_contracts §6.7).
    expose_headers=["X-Request-Id", "Location", "Idempotent-Replayed", "Retry-After"],
)


@app.get("/health", tags=["health"])
@app.get("/api/v1/health", tags=["health"])
def health_check() -> dict:
    """Return service health status for local verification and CI."""
    return {
        "status": "ok",
        "service": "vinergy-backend",
        "is_simulated": True,
    }
