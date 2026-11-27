"""Integration tests: reservation drafts and atomic confirmation on real PostgreSQL (WBS 2.2.1).

Opt-in like test_stations_postgres.py: TEST_DATABASE_URL must name an ISOLATED database
ending in "_test". Every test starts from db/reset.sql + db/seed.sql (which DELETE all rows).
Time is fixed through the service clock (Reservation_Design D-06), starting at T0.
"""

import json
import os
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import demo_session
from app.errors import ApiError
from app.main import app
from app.reservations import store
from app.reservations.config import ReservationSettings
from app.reservations.service import ReservationService
from app.reservations.validation import ConfirmRequest, DraftRequest
from app.stations.repository import MIGRATIONS_DIR, REPO_ROOT, SEED_SQL

psycopg = pytest.importorskip("psycopg")

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")

RESET_SQL = REPO_ROOT / "db" / "reset.sql"
SECRET = "test-session-secret"
T0 = datetime(2026, 11, 25, 8, 0, tzinfo=timezone.utc)
MIN = timedelta(minutes=1)


# --- database helpers ------------------------------------------------------------------------

def _script(conn, path):
    conn.execute(path.read_text(encoding="utf-8"))


def _prepare(url):
    """Create the schema on an empty DB, or bring a 001-only DB up to 002, then reset + seed."""
    with psycopg.connect(url, autocommit=True) as conn:
        if conn.execute("SELECT to_regclass('public.station')").fetchone()[0] is None:
            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                _script(conn, migration)
        elif conn.execute("SELECT 1 FROM pg_constraint WHERE conname = 'fk_draft_battery_stock'").fetchone():
            _script(conn, MIGRATIONS_DIR / "002_reservation_stock.sql")
        _script(conn, RESET_SQL)
        _script(conn, SEED_SQL)


def sql(url, statement, args=()):
    with psycopg.connect(url, autocommit=True) as conn:
        cur = conn.execute(statement, args)
        return cur.fetchall() if cur.description else None


def scalar(url, statement, args=()):
    return sql(url, statement, args)[0][0]


def stock(url, station="ST-01", family="FAM_A"):
    rows = sql(url, "SELECT available_batteries FROM station_battery_stock WHERE station_id = %s AND family_code = %s",
               (station, family))
    return rows[0][0] if rows else None


def totals(url):
    """(sum of all stock, number of orders, number of idempotency records): must not move on a rejection."""
    return (
        scalar(url, "SELECT coalesce(sum(available_batteries), 0) FROM station_battery_stock"),
        scalar(url, "SELECT count(*) FROM reservation"),
        scalar(url, "SELECT count(*) FROM idempotency_record"),
    )


# --- fixtures --------------------------------------------------------------------------------

class Clock:
    def __init__(self, now):
        self.now = now

    def __call__(self):
        return self.now


@pytest.fixture(scope="module")
def pg_url():
    dbname = psycopg.conninfo.conninfo_to_dict(TEST_DATABASE_URL).get("dbname", "")
    if not dbname.endswith("_test"):
        pytest.fail(f"Refusing to reset database {dbname!r}: TEST_DATABASE_URL must point to a *_test database.")
    _prepare(TEST_DATABASE_URL)
    yield TEST_DATABASE_URL
    _prepare(TEST_DATABASE_URL)


@pytest.fixture
def url(pg_url):
    _prepare(pg_url)
    return pg_url


@pytest.fixture
def clock():
    return Clock(T0)


@pytest.fixture
def svc(url, clock):
    return ReservationService(url, ReservationSettings(), SECRET, clock)


@pytest.fixture
def client(svc, monkeypatch):
    monkeypatch.setattr(app.state, "reservation_service", svc)
    return TestClient(app)


def login(url, user="USER-A", created=T0 - 10 * MIN, ttl=timedelta(hours=8), revoked=False):
    """Insert a demo session the way 2.2.3 will; return (cookie value, csrf token)."""
    raw = demo_session.new_raw_sid()
    sql(url,
        "INSERT INTO user_session (session_token_hash, user_id, created_at, expires_at, revoked_at)"
        " VALUES (%s, %s, %s, %s, %s)",
        (demo_session.session_token_hash(SECRET, raw), user, created, created + ttl, created if revoked else None))
    return raw, demo_session.csrf_token_for(SECRET, raw)


def call(client, method, path, session=None, body=None, key=None, csrf=True, content_type="application/json"):
    headers = {}
    if session:
        raw, token = session
        headers["Cookie"] = f"{demo_session.SESSION_COOKIE}={raw}"
        if csrf:
            headers[demo_session.CSRF_HEADER] = token
    if key:
        headers["Idempotency-Key"] = key
    if body is not None:
        headers["Content-Type"] = content_type
        content = body if isinstance(body, (bytes, str)) else json.dumps(body)
        return client.request(method, path, content=content, headers=headers)
    return client.request(method, path, headers=headers)


def error(response):
    body = response.json()["error"]
    return response.status_code, body["code"], [d["reason"] for d in body["details"]]


def draft(svc, user="USER-A", station="ST-01", family="FAM_A"):
    return svc.create_draft(user, DraftRequest(family, station_id=station))


def confirm_req(d, key, **override):
    fields = {"draft_id": d["draft_id"], "station_id": d["station"]["station_id"],
              "family_code": d["family_code"], "quantity": 1, **override}
    return ConfirmRequest(key, **fields)


def body_of(d, **override):
    return {"draft_id": d["draft_id"], "station_id": d["station"]["station_id"],
            "family_code": d["family_code"], "quantity": 1, **override}


def outcome(fn, *args):
    try:
        status, reservation = fn(*args)
        return status, reservation["reservation_id"]
    except ApiError as exc:
        return exc.code, exc.details[0]["reason"] if exc.details else None


def run_parallel(*calls):
    """Start every call at the same instant on its own thread/connection; return results in order."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def worker(i, fn, args):
        barrier.wait()
        results[i] = outcome(fn, *args)

    threads = [threading.Thread(target=worker, args=(i, fn, args)) for i, (fn, args) in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results


def slow_stock_take(monkeypatch, seconds=0.3):
    """Hold the stock row lock a little after taking a battery, so a competitor really waits on it."""
    original = store.take_one_battery

    def slow(conn, station_id, family_code):
        taken = original(conn, station_id, family_code)
        threading.Event().wait(seconds)
        return taken

    monkeypatch.setattr(store, "take_one_battery", slow)


KEY_A1 = "key-user-a-000000000001"
KEY_A2 = "key-user-a-000000000002"


# --- session, CSRF and request order (§1.3, §3) ------------------------------------------------

def test_session_is_checked_first(client):
    response = call(client, "POST", "/api/v1/reservations", body="not json", content_type="text/plain")
    assert error(response)[:2] == (401, "SESSION_REQUIRED")


def test_revoked_and_expired_sessions(client, url, clock):
    revoked = login(url, revoked=True)
    assert error(call(client, "GET", f"/api/v1/reservation-drafts/{'0' * 8}-0000-4000-8000-{'0' * 12}",
                      session=revoked))[:2] == (401, "SESSION_REQUIRED")
    short = login(url, created=T0 - 10 * MIN, ttl=10 * MIN)  # expires exactly at T0
    response = call(client, "POST", "/api/v1/reservation-drafts", session=short,
                    body={"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01"})
    assert error(response)[:2] == (401, "SESSION_EXPIRED")  # AE-23f, boundary is expired
    clock.now = T0 - timedelta(microseconds=1)
    assert call(client, "POST", "/api/v1/reservation-drafts", session=short,
                body={"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01"}).status_code == 201


def test_order_content_type_then_csrf_then_validation(client, url):
    session = login(url)
    bad = {"quantity": 2}
    assert error(call(client, "POST", "/api/v1/reservations", session=session, csrf=False,
                      body="x", content_type="text/plain"))[:2] == (415, "UNSUPPORTED_MEDIA_TYPE")
    assert error(call(client, "POST", "/api/v1/reservations", session=session, csrf=False,
                      body=bad))[:2] == (403, "CSRF_INVALID")
    status, code, reasons = error(call(client, "POST", "/api/v1/reservations", session=session, body=bad))
    assert (status, code) == (400, "INVALID_INPUT")
    assert reasons == ["REQUIRED", "REQUIRED", "REQUIRED", "REQUIRED", "MUST_BE_ONE"]


def test_csrf_of_another_session_is_rejected(client, url):
    a, b = login(url, "USER-A"), login(url, "USER-B")
    response = call(client, "POST", "/api/v1/reservation-drafts", session=(a[0], b[1]),
                    body={"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01"})
    assert error(response)[:2] == (403, "CSRF_INVALID")


# --- drafts (AE-03, AE-09, AE-10a, AE-18) -------------------------------------------------------

def test_ae09_draft_holds_no_stock(client, url):
    before = totals(url)
    response = call(client, "POST", "/api/v1/reservation-drafts", session=login(url),
                    body={"family_code": "FAM_A", "quantity": 1, "station_id": "ST-01"})
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["is_simulated"] is True
    d = body["draft"]
    assert d["status"] == "OPEN" and d["reservation_id"] is None
    assert d["station"] == {
        "station_id": "ST-01", "name": "Vinergy Demo Station 01", "area_label": "Hai Ba Trung demo area",
        "coordinates": {"lat": 21.005, "lng": 105.8435}, "distance_km": None, "distance_display": None,
    }
    assert (d["family_code"], d["quantity"], d["available_batteries"], d["hold_minutes"]) == ("FAM_A", 1, 6, 15)
    assert (d["created_at"], d["expires_at"]) == ("2026-11-25T08:00:00Z", "2026-11-25T08:05:00Z")
    assert totals(url) == before
    assert scalar(url, "SELECT user_id FROM reservation_draft WHERE draft_id = %s", (d["draft_id"],)) == "USER-A"


def test_ae18_nearest_skips_out_of_stock_station(client, url):
    response = call(client, "POST", "/api/v1/reservation-drafts", session=login(url),
                    body={"family_code": "FAM_A", "quantity": 1, "nearest": {"lat": 21.0032, "lng": 105.856}})
    station = response.json()["draft"]["station"]
    assert response.status_code == 201
    assert station["station_id"] == "ST-03"
    assert station["distance_km"] == pytest.approx(1.1619073809919698, abs=1e-12)
    assert station["distance_display"] == "1.2 km"


def test_ae18_nearest_does_not_widen_radius(client, url):
    response = call(client, "POST", "/api/v1/reservation-drafts", session=login(url),
                    body={"family_code": "FAM_A", "quantity": 1,
                          "nearest": {"lat": 21.0032, "lng": 105.856, "radius_km": 0.5}})
    assert error(response)[:2] == (409, "NO_ELIGIBLE_STATION")
    assert scalar(url, "SELECT count(*) FROM reservation_draft") == 0


@pytest.mark.parametrize("station, reason", [
    ("ST-02", "CHARGING_ONLY"), ("ST-04", "UNSUPPORTED_FAMILY"), ("ST-09", "STATION_CLOSED"),
    ("ST-13", "STATION_MAINTENANCE"), ("ST-05", "OUT_OF_STOCK"),
])
def test_ae10a_ineligible_station_gets_no_draft(client, url, station, reason):
    before = totals(url)
    response = call(client, "POST", "/api/v1/reservation-drafts", session=login(url),
                    body={"family_code": "FAM_A", "quantity": 1, "station_id": station})
    assert error(response) == (409, "STATION_NOT_ELIGIBLE", [reason])
    assert scalar(url, "SELECT count(*) FROM reservation_draft") == 0
    assert totals(url) == before


def test_unknown_station(client, url):
    response = call(client, "POST", "/api/v1/reservation-drafts", session=login(url),
                    body={"family_code": "FAM_A", "quantity": 1, "station_id": "ST-99"})
    assert error(response)[:2] == (404, "STATION_NOT_FOUND")


def test_get_draft_status_and_ownership(client, url, svc, clock):
    a = login(url, "USER-A")
    d = draft(svc)
    path = f"/api/v1/reservation-drafts/{d['draft_id']}"
    got = call(client, "GET", path, session=a).json()["draft"]
    assert got == d  # created by station_id, so distance is null both times
    assert error(call(client, "GET", path, session=login(url, "USER-B")))[:2] == (404, "DRAFT_NOT_FOUND")  # AE-14
    assert error(call(client, "GET", "/api/v1/reservation-drafts/not-a-uuid", session=a))[:3] == \
        (400, "INVALID_INPUT", ["INVALID_FORMAT"])
    clock.now = T0 + 4 * MIN
    status, r = svc.confirm("USER-A", confirm_req(d, KEY_A1))
    used = call(client, "GET", path, session=a).json()["draft"]
    assert (used["status"], used["reservation_id"], used["available_batteries"]) == ("USED", r["reservation_id"], 5)
    clock.now = T0 + 5 * MIN
    assert call(client, "GET", path, session=a).json()["draft"]["status"] == "USED"  # USED wins over EXPIRED
    other = draft(svc)
    clock.now = T0 + 10 * MIN + 5 * MIN
    assert call(client, "GET", f"/api/v1/reservation-drafts/{other['draft_id']}", session=a)\
        .json()["draft"]["status"] == "EXPIRED"


# --- confirmation (AE-10, AE-10b, AE-09a, AE-17) -----------------------------------------------

def test_ae10_confirm_takes_exactly_one_battery(client, url, svc, clock):
    session = login(url)
    d = draft(svc)
    ports_before = sql(url, "SELECT station_id, family_code, available_ports FROM station_charging_port ORDER BY 1, 2")
    clock.now = T0 + 4 * MIN
    response = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert response.status_code == 201
    r = response.json()["reservation"]
    assert response.headers["location"] == f"/api/v1/reservations/{r['reservation_id']}"
    assert response.headers["cache-control"] == "no-store"
    assert "idempotent-replayed" not in response.headers
    assert r == {
        "reservation_id": r["reservation_id"], "status": "ACTIVE", "draft_id": d["draft_id"],
        "station": {"station_id": "ST-01", "name": "Vinergy Demo Station 01",
                    "area_label": "Hai Ba Trung demo area", "coordinates": {"lat": 21.005, "lng": 105.8435}},
        "family_code": "FAM_A", "quantity": 1,
        "created_at": "2026-11-25T08:04:00Z", "expires_at": "2026-11-25T08:19:00Z",  # AE-10b: 15 min from confirm
        "cancelled_at": None, "expired_at": None,
    }
    assert (stock(url), stock(url, family="FAM_B")) == (5, 4)
    assert sql(url, "SELECT station_id, family_code, available_ports FROM station_charging_port ORDER BY 1, 2") \
        == ports_before
    assert scalar(url, "SELECT count(*) FROM reservation") == 1


def test_ae10b_hold_follows_configuration(url, clock):
    svc = ReservationService(url, ReservationSettings(hold_minutes=20), SECRET, clock)
    d = draft(svc)
    clock.now = T0 + 4 * MIN
    assert draft(svc)["hold_minutes"] == 20
    _, r = svc.confirm("USER-A", confirm_req(d, KEY_A1))
    assert r["expires_at"] == "2026-11-25T08:24:00Z"


def test_ae09a_confirm_exactly_at_draft_expiry_is_rejected_and_keeps_nothing(svc, url, clock):
    d = draft(svc)
    before = totals(url)
    clock.now = T0 + 5 * MIN
    assert outcome(svc.confirm, "USER-A", confirm_req(d, KEY_A1)) == ("DRAFT_STALE", "DRAFT_EXPIRED")
    assert totals(url) == before
    # Rejected requests store nothing, so the same key works with a fresh draft.
    fresh = draft(svc)
    assert outcome(svc.confirm, "USER-A", confirm_req(fresh, KEY_A1))[0] == 201


@pytest.mark.parametrize("override, field", [
    ({"station_id": "ST-03"}, "station_id"), ({"family_code": "FAM_B"}, "family_code"),
])
def test_body_must_match_the_draft(svc, url, override, field):
    d = draft(svc)
    before = totals(url)
    with pytest.raises(ApiError) as exc:
        svc.confirm("USER-A", confirm_req(d, KEY_A1, **override))
    assert (exc.value.code, exc.value.details[0]["field"], exc.value.details[0]["reason"]) == \
        ("DRAFT_STALE", field, "CONTENT_MISMATCH")
    assert totals(url) == before


def test_ae17_used_draft_with_new_key(svc, url):
    d = draft(svc)
    svc.confirm("USER-A", confirm_req(d, KEY_A1))
    assert outcome(svc.confirm, "USER-A", confirm_req(d, KEY_A2)) == ("DRAFT_ALREADY_USED", None)
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (5, 1)


def test_ae14_other_users_draft_is_not_found(client, url, svc):
    d = draft(svc, "USER-A")
    response = call(client, "POST", "/api/v1/reservations", session=login(url, "USER-B"), key=KEY_A1, body=body_of(d))
    assert error(response)[:2] == (404, "DRAFT_NOT_FOUND")
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (6, 0)


# --- AE-10a at confirmation: the station changes after the draft -------------------------------

AE10A_CHANGES = {
    "STATION_CLOSED": ["UPDATE station SET opening_status = 'CLOSED' WHERE station_id = 'ST-01'"],
    "STATION_MAINTENANCE": ["UPDATE station SET opening_status = 'MAINTENANCE' WHERE station_id = 'ST-01'",
                            "UPDATE station_battery_stock SET available_batteries = 0 WHERE station_id = 'ST-01'"],
    "OUT_OF_STOCK": ["UPDATE station_battery_stock SET available_batteries = 0"
                     " WHERE station_id = 'ST-01' AND family_code = 'FAM_A'"],
    "CHARGING_ONLY": ["DELETE FROM station_battery_stock WHERE station_id = 'ST-01'"],
    "UNSUPPORTED_FAMILY": ["DELETE FROM station_battery_stock WHERE station_id = 'ST-01' AND family_code = 'FAM_A'",
                           "DELETE FROM station_charging_port WHERE station_id = 'ST-01' AND family_code = 'FAM_A'"],
}


@pytest.mark.parametrize("reason", list(AE10A_CHANGES))
def test_ae10a_station_changed_before_confirm(svc, url, reason):
    d = draft(svc)
    for statement in AE10A_CHANGES[reason]:
        sql(url, statement)
    before = totals(url)
    assert outcome(svc.confirm, "USER-A", confirm_req(d, KEY_A1)) == ("STATION_NOT_ELIGIBLE", reason)
    assert totals(url) == before


def test_active_order_protects_its_stock_row(svc, url):
    """Migration 002: the row an ACTIVE order will release into cannot be deleted."""
    svc.confirm("USER-A", confirm_req(draft(svc), KEY_A1))
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        sql(url, "DELETE FROM station_battery_stock WHERE station_id = 'ST-01' AND family_code = 'FAM_A'")
    assert stock(url) == 5


# --- retries and idempotency (AE-11, AE-12) ---------------------------------------------------

def test_ae11_replay_returns_the_same_order(client, url, svc, clock):
    session = login(url)
    d = draft(svc)
    clock.now = T0 + 4 * MIN
    first = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert first.status_code == 201
    rid = first.json()["reservation"]["reservation_id"]

    clock.now = T0 + 10 * MIN  # draft expired, order still held
    replay = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1,
                  body=dict(reversed(list(body_of(d).items()))))  # key order does not matter
    assert replay.status_code == 200
    assert replay.headers["idempotent-replayed"] == "true"
    assert "location" not in replay.headers
    assert replay.json()["reservation"] == first.json()["reservation"]
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (5, 1)

    clock.now = T0 + 19 * MIN  # hold over: replay reconciles to EXPIRED and releases once (BR-09)
    expired = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert expired.status_code == 200
    assert (expired.json()["reservation"]["reservation_id"], expired.json()["reservation"]["status"]) == \
        (rid, "EXPIRED")
    assert expired.json()["reservation"]["expired_at"] == "2026-11-25T08:19:00Z"
    again = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert again.json()["reservation"]["status"] == "EXPIRED"
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (6, 1)


def test_ae12_same_key_different_body(svc, url):
    d1, d2 = draft(svc), draft(svc, station="ST-03")
    svc.confirm("USER-A", confirm_req(d1, KEY_A1))
    before = totals(url)
    assert outcome(svc.confirm, "USER-A", confirm_req(d2, KEY_A1)) == ("IDEMPOTENCY_KEY_REUSED", None)
    assert totals(url) == before


def test_keys_are_scoped_per_user(svc, url):
    svc.confirm("USER-A", confirm_req(draft(svc, "USER-A"), KEY_A1))
    assert outcome(svc.confirm, "USER-B", confirm_req(draft(svc, "USER-B"), KEY_A1))[0] == 201
    assert stock(url) == 4


def test_ae11a_two_independent_orders_for_one_user(svc, url):
    r1 = outcome(svc.confirm, "USER-A", confirm_req(draft(svc), KEY_A1))
    r2 = outcome(svc.confirm, "USER-A", confirm_req(draft(svc), KEY_A2))
    assert r1[0] == r2[0] == 201 and r1[1] != r2[1]
    assert stock(url) == 4


def test_request_in_progress_when_same_key_is_busy(client, url, clock, monkeypatch):
    svc = ReservationService(url, ReservationSettings(idempotency_lock_timeout_ms=200), SECRET, clock)
    monkeypatch.setattr(app.state, "reservation_service", svc)
    session = login(url)
    d = draft(svc)
    with psycopg.connect(url, autocommit=True) as holder, holder.transaction():
        store.advisory_lock(holder, "USER-A", KEY_A1)  # another request with this key is "running"
        busy = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert error(busy)[:2] == (409, "REQUEST_IN_PROGRESS")
    assert busy.headers["retry-after"] == "1"
    assert (stock(url), scalar(url, "SELECT count(*) FROM idempotency_record")) == (6, 0)
    retry = call(client, "POST", "/api/v1/reservations", session=session, key=KEY_A1, body=body_of(d))
    assert retry.status_code == 201


def test_failure_after_taking_stock_rolls_everything_back(svc, url, monkeypatch):
    """BR-07: no half-made order. Break the last write; stock, order and key must all be untouched."""
    d = draft(svc)
    before = totals(url)

    def broken(*args, **kwargs):
        raise RuntimeError("simulated crash after stock was taken")

    monkeypatch.setattr(store, "insert_idempotency", broken)
    with pytest.raises(RuntimeError):
        svc.confirm("USER-A", confirm_req(d, KEY_A1))
    assert totals(url) == before
    monkeypatch.undo()
    assert outcome(svc.confirm, "USER-A", confirm_req(d, KEY_A1))[0] == 201  # draft still usable


# --- concurrency: never overbook (AE-13, AE-11, AE-17) -------------------------------------------

@pytest.mark.parametrize("round_no", range(3))
def test_ae13_last_battery_goes_to_exactly_one_user(svc, url, monkeypatch, round_no):
    sql(url, "UPDATE station_battery_stock SET available_batteries = 1 WHERE station_id = 'ST-01' AND family_code = 'FAM_A'")
    da, db = draft(svc, "USER-A"), draft(svc, "USER-B")
    slow_stock_take(monkeypatch)
    results = run_parallel(
        (svc.confirm, ("USER-A", confirm_req(da, KEY_A1))),
        (svc.confirm, ("USER-B", confirm_req(db, KEY_A2))),
    )
    assert sorted(r[0] for r in results if r[0] == 201) == [201]
    assert [r for r in results if r[0] != 201] == [("STATION_NOT_ELIGIBLE", "OUT_OF_STOCK")]
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (0, 1)


def test_many_users_two_batteries_never_overbooked(svc, url):
    users = ["USER-A", "USER-B", "USER-C", "USER-D", "USER-E", "USER-F"]
    sql(url, "INSERT INTO app_user (user_id) VALUES ('USER-C'), ('USER-D'), ('USER-E'), ('USER-F')")
    sql(url, "UPDATE station_battery_stock SET available_batteries = 2 WHERE station_id = 'ST-01' AND family_code = 'FAM_A'")
    drafts = [draft(svc, u) for u in users]
    results = run_parallel(*[
        (svc.confirm, (u, confirm_req(d, f"key-{u.lower()}-concurrent-1"))) for u, d in zip(users, drafts)
    ])
    assert sum(1 for r in results if r[0] == 201) == 2
    assert sorted(r for r in results if r[0] != 201) == [("STATION_NOT_ELIGIBLE", "OUT_OF_STOCK")] * 4
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (0, 2)


def test_ae11_concurrent_retries_with_same_key_make_one_order(svc, url, monkeypatch):
    d = draft(svc)
    slow_stock_take(monkeypatch)
    results = run_parallel(
        (svc.confirm, ("USER-A", confirm_req(d, KEY_A1))),
        (svc.confirm, ("USER-A", confirm_req(d, KEY_A1))),
    )
    assert sorted(r[0] for r in results) == [200, 201]
    assert results[0][1] == results[1][1]
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (5, 1)


def test_ae17_same_draft_two_keys_concurrently(svc, url, monkeypatch):
    d = draft(svc)
    slow_stock_take(monkeypatch)
    results = run_parallel(
        (svc.confirm, ("USER-A", confirm_req(d, KEY_A1))),
        (svc.confirm, ("USER-A", confirm_req(d, KEY_A2))),
    )
    assert sum(1 for r in results if r[0] == 201) == 1
    assert [r for r in results if r[0] != 201] == [("DRAFT_ALREADY_USED", None)]
    assert (stock(url), scalar(url, "SELECT count(*) FROM reservation")) == (5, 1)
