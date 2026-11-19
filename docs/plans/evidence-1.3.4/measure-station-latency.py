"""Run with PYTHONPATH pointing to backend. Write raw CSV to stdout."""
import csv
import os
import sys
from time import perf_counter_ns

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = ""
from app.main import app


async def measured_app(scope, receive, send):
    if scope["type"] != "http":
        return await app(scope, receive, send)
    start = perf_counter_ns()

    async def observed_send(event):
        if event["type"] == "http.response.body" and not event.get("more_body"):
            elapsed_ms.append((perf_counter_ns() - start) / 1_000_000)
        await send(event)

    await app(scope, receive, observed_send)


elapsed_ms = []
writer = csv.writer(sys.stdout)
writer.writerow(["location", "phase", "run", "duration_ms", "http_status", "stations", "outcome"])
with TestClient(measured_app, raise_server_exceptions=False) as client:
    for loc, lat, lng, radius, expected in [
        ("LOC-01", 21.005, 105.8435, 2, 4),
        ("LOC-03", 21.2, 105.2, 0.5, 0),
    ]:
        params = dict(lat=lat, lng=lng, radius_km=radius, service_type="SWAPPING", family_code="FAM_A")
        for phase, count in [("warmup", 5), ("measured", 100)]:
            for run in range(1, count + 1):
                elapsed_ms.clear()
                response = client.get("/api/v1/stations", params=params)
                assert len(elapsed_ms) == 1, "Missing final ASGI response body"
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
                stations = payload.get("stations") if isinstance(payload, dict) else None
                size = len(stations) if isinstance(stations, list) else ""
                outcome = "ok" if response.status_code == 200 and size == expected else "error"
                if response.status_code in (408, 504):
                    outcome = "timeout"
                writer.writerow([loc, phase, run, f"{elapsed_ms[0]:.6f}", response.status_code, size, outcome])
