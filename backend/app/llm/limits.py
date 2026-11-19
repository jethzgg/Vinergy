"""Sliding-window limits for the single-worker spike."""

import math
import time
from threading import Lock

_WINDOW_SECONDS = 60


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


class InMemoryRateLimiter:
    def __init__(self):
        self._lock = Lock()
        self._requests: dict[str, list[float]] = {}
        self._next_cleanup = float("-inf")

    def is_allowed(self, key: str, limit: int) -> tuple[bool, int]:
        with self._lock:
            now = time.monotonic()
            cutoff = now - _WINDOW_SECONDS
            if now >= self._next_cleanup:
                self._requests = {
                    name: timestamps
                    for name, timestamps in self._requests.items()
                    if timestamps[-1] > cutoff
                }
                self._next_cleanup = now + _WINDOW_SECONDS
            history = [ts for ts in self._requests.get(key, []) if ts > cutoff]
            if len(history) >= limit:
                return False, max(1, math.ceil(history[0] - cutoff))
            self._requests[key] = [*history, now]
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._requests.clear()
            self._next_cleanup = float("-inf")


google_call_limiter = InMemoryRateLimiter()
