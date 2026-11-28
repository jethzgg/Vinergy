"""Shared fixtures: seed-backed service (unit) and HTTP client (API)."""

import os

# Tests never use the developer database or its .env SESSION_SECRET: app.main must import
# without them (load_dotenv does not override an existing variable). PostgreSQL tests
# build their own services on TEST_DATABASE_URL.
os.environ["DATABASE_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.stations.repository import InMemoryStationRepository, sqlite_repository  # noqa: E402
from app.stations.service import StationService  # noqa: E402

LOC_01 = (21.005, 105.8435)
LOC_02 = (21.0285, 105.8542)
LOC_03 = (21.2, 105.2)

# Distance oracle from LOC-01 (Acceptance_Examples_and_Sample_Data.md, 6 d.p.) and display label.
LOC_01_ORACLE = {
    "ST-01": (0.000000, "0.0 km"),
    "ST-02": (2.693266, "2.7 km"),
    "ST-03": (0.934066, "0.9 km"),
    "ST-04": (1.284229, "1.3 km"),
    "ST-05": (1.312928, "1.3 km"),
    "ST-06": (1.653278, "1.7 km"),
    "ST-07": (3.298900, "3.3 km"),
    "ST-08": (2.474380, "2.5 km"),
    "ST-09": (2.181404, "2.2 km"),
    "ST-10": (4.385670, "4.4 km"),
    "ST-11": (7.251966, "7.3 km"),
    "ST-12": (6.837912, "6.8 km"),
    "ST-13": (4.374298, "4.4 km"),
    "ST-14": (2.919854, "2.9 km"),
    "ST-15": (5.358737, "5.4 km"),
    "ST-16": (2.843062, "2.8 km"),
    "ST-17": (4.555453, "4.6 km"),
    "ST-18": (6.269174, "6.3 km"),
}


@pytest.fixture
def repo():
    return InMemoryStationRepository.from_fixture()


@pytest.fixture
def service(repo):
    return StationService(repo)


@pytest.fixture
def client(monkeypatch):
    """App with the SQL repository over a fresh SQLite copy of db/migrations + seed.sql.

    Pinned explicitly so these tests never touch the DATABASE_URL database;
    PostgreSQL is covered by test_stations_postgres.py.
    """
    monkeypatch.setattr(app.state, "station_service", StationService(sqlite_repository()))
    return TestClient(app)
