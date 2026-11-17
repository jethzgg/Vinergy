"""Minimal runnable FastAPI skeleton for Vinergy (Task 1.3.1)."""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Vinergy API",
    version="0.1.0",
    description="Academic demo API for charging/swapping station discovery and battery reservation.",
)

allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
