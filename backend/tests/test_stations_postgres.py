"""Integration tests against a real PostgreSQL database (AD-02, architecture §8 "Integration").

Opt-in: set TEST_DATABASE_URL (e.g. in the repo-root .env) to an ISOLATED database whose
name ends with "_test". The module creates the schema if missing, then runs
db/reset.sql + db/seed.sql (which DELETE all rows) before and after the tests.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.stations.repository import (
    MIGRATIONS_DIR,
    REPO_ROOT,
    SEED_SQL,
    InMemoryStationRepository,
    postgres_repository,
)
from app.stations.service import StationService
from app.stations.validation import DetailQuery, SearchQuery
from tests.conftest import LOC_01, LOC_01_ORACLE

psycopg = pytest.importorskip("psycopg")

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")

RESET_SQL = REPO_ROOT / "db" / "reset.sql"
VALIDATE_SQL = REPO_ROOT / "db" / "validate_seed.sql"


def _run_script(conn, path):
    conn.execute(path.read_text(encoding="utf-8"))


def _reset_and_seed(url):
    with psycopg.connect(url, autocommit=True) as conn:
        if conn.execute("SELECT to_regclass('public.station')").fetchone()[0] is None:
            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                _run_script(conn, migration)
        else:
            _run_script(conn, RESET_SQL)
        _run_script(conn, SEED_SQL)


@pytest.fixture(scope="module")
def pg_url():
    dbname = psycopg.conninfo.conninfo_to_dict(TEST_DATABASE_URL).get("dbname", "")
    if not dbname.endswith("_test"):
        pytest.fail(f"Refusing to reset database {dbname!r}: TEST_DATABASE_URL must point to a *_test database.")
    _reset_and_seed(TEST_DATABASE_URL)
    yield TEST_DATABASE_URL
    _reset_and_seed(TEST_DATABASE_URL)


@pytest.fixture(scope="module")
def pg_service(pg_url):
    return StationService(postgres_repository(pg_url))


@pytest.fixture
def pg_client(pg_service, monkeypatch):
    monkeypatch.setattr(app.state, "station_service", pg_service)
    return TestClient(app)


def test_seed_validation_passes(pg_url):
    with psycopg.connect(pg_url) as conn:
        rows = conn.execute(VALIDATE_SQL.read_text(encoding="utf-8")).fetchall()
    assert rows, "validate_seed.sql returned no checks"
    assert [r for r in rows if r[-1] != "PASS"] == []


def test_repository_matches_json_fixture(pg_service):
    fixture = InMemoryStationRepository.from_fixture()
    pg_repo = pg_service._repo
    assert sorted(pg_repo.list_all(), key=lambda s: s.station_id) == sorted(
        fixture.list_all(), key=lambda s: s.station_id
    )
    assert pg_repo.get("ST-05") == fixture.get("ST-05")
    assert pg_repo.get("ST-99") is None


@pytest.mark.parametrize("service_type", ["CHARGING", "SWAPPING"])
@pytest.mark.parametrize("family_code", ["FAM_A", "FAM_B"])
@pytest.mark.parametrize("only_open", [True, False])
def test_search_same_as_fixture(pg_service, service, service_type, family_code, only_open):
    q = SearchQuery(*LOC_01, service_type, family_code, only_open, None)
    assert pg_service.search(q) == service.search(q)


def test_ae01_over_http(pg_client):
    response = pg_client.get(
        "/api/v1/stations?lat=21.005&lng=105.8435&service_type=SWAPPING&family_code=FAM_A&radius_km=2"
    )
    assert response.status_code == 200
    body = response.json()
    assert [s["station_id"] for s in body["stations"]] == ["ST-01", "ST-03", "ST-05", "ST-06"]
    for station in body["stations"]:
        assert station["distance_km"] == pytest.approx(LOC_01_ORACLE[station["station_id"]][0], abs=1e-6)
    assert isinstance(body["stations"][0]["coordinates"]["lat"], float)  # NUMERIC -> float, not string


def test_ae02_detail_over_http(pg_client):
    station = pg_client.get("/api/v1/stations/ST-04?family_code=FAM_A&lat=21.005&lng=105.8435").json()["station"]
    assert (station["family_supported"], station["ineligibility_reason"]) == (False, "UNSUPPORTED_FAMILY")


def test_unknown_station_over_http(pg_client):
    assert pg_client.get("/api/v1/stations/ST-99").json()["error"]["code"] == "STATION_NOT_FOUND"


def test_reads_live_stock(pg_url, pg_service):
    """Eligibility reflects the current row, not a cached copy; restored by reset afterwards."""
    q = DetailQuery("ST-05", "FAM_A")
    assert pg_service.detail(q)["station"]["ineligibility_reason"] == "OUT_OF_STOCK"
    with psycopg.connect(pg_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE station_battery_stock SET available_batteries = 1 "
            "WHERE station_id = 'ST-05' AND family_code = 'FAM_A'"
        )
    try:
        station = pg_service.detail(q)["station"]
        assert station["available_batteries_by_family"]["FAM_A"] == 1
        assert (station["booking_eligible"], station["ineligibility_reason"]) == (True, None)
    finally:
        _reset_and_seed(pg_url)
