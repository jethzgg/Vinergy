"""Reservation timing configuration (architecture §8, SRS §8 demo proposal)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class ReservationSettings:
    draft_ttl_minutes: int = 5  # DRAFT_TTL_MINUTES, counted from draft creation (AE-09a)
    hold_minutes: int = 15  # RESERVATION_HOLD_MINUTES, counted from successful confirmation (AE-10b)
    idempotency_lock_timeout_ms: int = 5000  # IDEMPOTENCY_LOCK_TIMEOUT_MS -> 409 REQUEST_IN_PROGRESS

    def __post_init__(self):
        for name in ("draft_ttl_minutes", "hold_minutes", "idempotency_lock_timeout_ms"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer, got {value!r}")

    @property
    def draft_ttl(self) -> timedelta:
        return timedelta(minutes=self.draft_ttl_minutes)

    @property
    def hold(self) -> timedelta:
        return timedelta(minutes=self.hold_minutes)

    @classmethod
    def from_env(cls) -> "ReservationSettings":
        def read(name: str, default: int) -> int:
            raw = os.getenv(name, "").strip()
            return int(raw) if raw else default

        return cls(
            draft_ttl_minutes=read("DRAFT_TTL_MINUTES", cls.draft_ttl_minutes),
            hold_minutes=read("RESERVATION_HOLD_MINUTES", cls.hold_minutes),
            idempotency_lock_timeout_ms=read("IDEMPOTENCY_LOCK_TIMEOUT_MS", cls.idempotency_lock_timeout_ms),
        )


def utc_now() -> datetime:
    """Server clock (AD-07). Injected into the service so tests can fix time (D-06)."""
    return datetime.now(timezone.utc)
