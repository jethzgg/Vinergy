"""Station data access (AD-01: only this module reads station tables).

- `SqlStationRepository` reads the relational schema from db/migrations (station,
  station_battery_stock, station_charging_port) through any DB-API connection.
- `postgres_repository(url)` is the real backend (AD-02), selected by DATABASE_URL.
- `sqlite_repository()` builds a throwaway in-memory copy of migrations + seed.sql
  (same as db/check_seed.py); used only when DATABASE_URL is not set.
- `InMemoryStationRepository` holds plain `Station` objects, for unit tests.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Callable, ContextManager, Iterable, Optional, Protocol

from app.stations.domain import Station

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
SEED_SQL = REPO_ROOT / "db" / "seed.sql"
SEED_JSON = REPO_ROOT / "data" / "seed_stations_v0.json"


class StationRepository(Protocol):
    def list_all(self) -> list: ...

    def get(self, station_id: str) -> Optional[Station]: ...


class InMemoryStationRepository:
    def __init__(self, stations: Iterable[Station]):
        self._stations = {s.station_id: s for s in stations}

    @classmethod
    def from_fixture(cls, path: Path = SEED_JSON) -> "InMemoryStationRepository":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(station_from_json(item) for item in data["stations"])

    def list_all(self) -> list:
        return list(self._stations.values())

    def get(self, station_id: str) -> Optional[Station]:
        return self._stations.get(station_id)


def station_from_json(item: dict) -> Station:
    return Station(
        station_id=item["station_id"],
        name=item["name"],
        area_label=item["area_label"],
        lat=float(item["coordinates"]["lat"]),
        lng=float(item["coordinates"]["lng"]),
        opening_status=item["opening_status"],
        available_batteries_by_family=dict(item["available_batteries_by_family"]),
        available_charging_ports_by_family=dict(item["available_charging_ports_by_family"]),
    )


class SqlStationRepository:
    """Reads stations with their per-family resources through a DB-API connection.

    `connect` is a zero-argument callable returning a context manager that yields a
    connection, so PostgreSQL can open one read-only transaction per call while the
    SQLite fallback reuses its single in-memory connection.
    `placeholder` is the driver's paramstyle marker: `%s` for psycopg, `?` for sqlite3.
    """

    _STATIONS = "SELECT station_id, name, area_label, lat, lng, opening_status FROM station"
    _BATTERIES = "SELECT station_id, family_code, available_batteries FROM station_battery_stock"
    _PORTS = "SELECT station_id, family_code, available_ports FROM station_charging_port"

    def __init__(self, connect: Callable[[], ContextManager], placeholder: str = "%s"):
        self._connect = connect
        self._placeholder = placeholder

    def list_all(self) -> list:
        return self._load()

    def get(self, station_id: str) -> Optional[Station]:
        found = self._load(station_id)
        return found[0] if found else None

    def _load(self, station_id: Optional[str] = None) -> list:
        if station_id is None:
            where, args = "", ()
        else:
            where, args = f" WHERE station_id = {self._placeholder}", (station_id,)
        # All three reads run on one connection/transaction, so stock and station
        # rows come from the same snapshot.
        with self._connect() as conn:
            cur = conn.cursor()
            try:
                cur.execute(self._STATIONS + where, args)
                rows = cur.fetchall()
                cur.execute(self._BATTERIES + where, args)
                batteries = _group(cur.fetchall())
                cur.execute(self._PORTS + where, args)
                ports = _group(cur.fetchall())
            finally:
                cur.close()
        return [
            Station(
                station_id=sid,
                name=name,
                area_label=area,
                lat=float(lat),  # NUMERIC may come back as Decimal on PostgreSQL
                lng=float(lng),
                opening_status=status,
                available_batteries_by_family=batteries.get(sid, {}),
                available_charging_ports_by_family=ports.get(sid, {}),
            )
            for sid, name, area, lat, lng, status in rows
        ]


def _group(rows) -> dict:
    grouped: dict = {}
    for station_id, family_code, count in rows:
        grouped.setdefault(station_id, {})[family_code] = int(count)
    return grouped


def postgres_repository(database_url: str) -> SqlStationRepository:
    """Repository over PostgreSQL (AD-02). One short read-only REPEATABLE READ transaction per call."""
    import psycopg

    @contextmanager
    def connect():
        with psycopg.connect(database_url, connect_timeout=5) as conn:
            conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            conn.read_only = True
            yield conn

    return SqlStationRepository(connect, placeholder="%s")


def sqlite_repository(connection: Optional[sqlite3.Connection] = None) -> SqlStationRepository:
    """Repository over an in-memory SQLite copy of migrations + seed (fallback, no DATABASE_URL)."""
    conn = connection or create_seeded_sqlite()
    connection_lock = Lock()

    @contextmanager
    def connect():
        # FastAPI runs sync handlers on worker threads. Give one reader exclusive
        # use of the shared SQLite connection until all three results are fetched.
        with connection_lock:
            yield conn

    return SqlStationRepository(connect, placeholder="?")


def create_seeded_sqlite() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
        variant = MIGRATIONS_DIR / "sqlite" / migration.name
        migration = variant if variant.exists() else migration
        conn.executescript(migration.read_text(encoding="utf-8"))
    conn.executescript(SEED_SQL.read_text(encoding="utf-8"))
    return conn
