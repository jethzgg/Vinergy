"""SQL for drafts and reservations on PostgreSQL (Reservation_Design §6).

Every function takes an open psycopg connection; the caller owns the transaction.
Lock order inside a confirmation is fixed: advisory lock -> draft -> station -> stock
rows -> insert (Reservation_Design §6.3), so concurrent requests cannot deadlock.
"""

from __future__ import annotations

from contextlib import nullcontext
from datetime import datetime, timezone
from typing import Optional

from app.stations.domain import Station
from app.stations.repository import SqlStationRepository

OPERATION = "CONFIRM_RESERVATION"


def iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def station_in_tx(conn, station_id: str) -> Optional[Station]:
    """Read the station (status, swap/charge rows, stock) inside the caller's transaction."""
    return SqlStationRepository(lambda: nullcontext(conn), placeholder="%s").get(station_id)


# --- drafts ---------------------------------------------------------------------------

def insert_draft(conn, draft_id: str, user_id: str, station_id: str, family_code: str,
                 created_at: datetime, expires_at: datetime) -> None:
    conn.execute(
        "INSERT INTO reservation_draft (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)"
        " VALUES (%s, %s, %s, %s, 1, %s, %s)",
        (draft_id, user_id, station_id, family_code, created_at, expires_at),
    )


def find_draft(conn, user_id: str, draft_id: str) -> Optional[tuple]:
    """(station_id, family_code, quantity, created_at, expires_at, reservation_id) of the caller's draft."""
    return conn.execute(
        "SELECT d.station_id, d.family_code, d.quantity, d.created_at, d.expires_at, r.reservation_id"
        "  FROM reservation_draft d LEFT JOIN reservation r ON r.draft_id = d.draft_id"
        " WHERE d.draft_id = %s AND d.user_id = %s",
        (draft_id, user_id),
    ).fetchone()


def lock_draft(conn, user_id: str, draft_id: str) -> Optional[tuple]:
    """Step (3): lock the caller's own draft; another user's draft is invisible (AE-14)."""
    return conn.execute(
        "SELECT station_id, family_code, quantity, expires_at FROM reservation_draft"
        " WHERE draft_id = %s AND user_id = %s FOR UPDATE",
        (draft_id, user_id),
    ).fetchone()


def draft_is_used(conn, draft_id: str) -> bool:
    return conn.execute("SELECT 1 FROM reservation WHERE draft_id = %s", (draft_id,)).fetchone() is not None


# --- idempotency ----------------------------------------------------------------------

def set_lock_timeout(conn, milliseconds: int) -> None:
    """Transaction-local lock_timeout; 0 disables it (used right after the advisory lock)."""
    conn.execute("SELECT set_config('lock_timeout', %s, true)", (f"{milliseconds}ms",))


def advisory_lock(conn, user_id: str, idempotency_key: str) -> None:
    """Step (1): serialise requests with the same (user, operation, key)."""
    conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
        (f"{user_id}|{OPERATION}|{idempotency_key}",),
    )


def find_idempotency(conn, user_id: str, idempotency_key: str) -> Optional[tuple]:
    """Step (2): (request_hash, reservation_id) if this key already produced an order."""
    return conn.execute(
        "SELECT request_hash, reservation_id FROM idempotency_record"
        " WHERE user_id = %s AND operation = %s AND idempotency_key = %s",
        (user_id, OPERATION, idempotency_key),
    ).fetchone()


def insert_idempotency(conn, user_id: str, idempotency_key: str, request_hash: str,
                       reservation_id: str, now: datetime) -> None:
    conn.execute(
        "INSERT INTO idempotency_record"
        " (user_id, operation, idempotency_key, request_hash, reservation_id, created_at)"
        " VALUES (%s, %s, %s, %s, %s, %s)",
        (user_id, OPERATION, idempotency_key, request_hash, reservation_id, now),
    )


# --- stock and reservations -----------------------------------------------------------

def lock_station_and_stock(conn, station_id: str) -> None:
    """Step (4): station FOR SHARE (status cannot change under us), then its stock rows."""
    conn.execute("SELECT 1 FROM station WHERE station_id = %s FOR SHARE", (station_id,))
    conn.execute(
        "SELECT family_code FROM station_battery_stock WHERE station_id = %s ORDER BY family_code FOR UPDATE",
        (station_id,),
    ).fetchall()


def take_one_battery(conn, station_id: str, family_code: str) -> bool:
    """Step (5): decrement only while stock >= 1, so the last battery is never overbooked (AE-13)."""
    cur = conn.execute(
        "UPDATE station_battery_stock SET available_batteries = available_batteries - 1"
        " WHERE station_id = %s AND family_code = %s AND available_batteries >= 1",
        (station_id, family_code),
    )
    return cur.rowcount == 1


def insert_reservation(conn, reservation_id: str, draft_id: str, created_at: datetime,
                       expires_at: datetime) -> None:
    conn.execute(
        "INSERT INTO reservation (reservation_id, draft_id, status, created_at, expires_at)"
        " VALUES (%s, %s, 'ACTIVE', %s, %s)",
        (reservation_id, draft_id, created_at, expires_at),
    )


def expire_if_due(conn, reservation_id: str, now: datetime) -> bool:
    """BR-09 reconciliation used on replay: ACTIVE and due -> EXPIRED, release the battery once.

    One statement, conditional on status = 'ACTIVE', so it is safe against concurrent
    cancel/expiry (Reservation_Design §6.4). 2.2.5 (M6) owns the shared release routine;
    replace this with it once available.
    """
    cur = conn.execute(
        "WITH e AS (UPDATE reservation SET status = 'EXPIRED', expired_at = %s"
        "            WHERE reservation_id = %s AND status = 'ACTIVE' AND %s >= expires_at"
        "        RETURNING draft_id)"
        " UPDATE station_battery_stock s SET available_batteries = s.available_batteries + 1"
        "   FROM e JOIN reservation_draft d ON d.draft_id = e.draft_id"
        "  WHERE s.station_id = d.station_id AND s.family_code = d.family_code",
        (now, reservation_id, now),
    )
    return cur.rowcount == 1


def reservation_view(conn, reservation_id: str) -> dict:
    """The `reservation` object of api_contracts §6.6."""
    row = conn.execute(
        "SELECT r.reservation_id, r.status, r.draft_id, d.station_id, s.name, s.area_label, s.lat, s.lng,"
        "       d.family_code, d.quantity, r.created_at, r.expires_at, r.cancelled_at, r.expired_at"
        "  FROM reservation r"
        "  JOIN reservation_draft d ON d.draft_id = r.draft_id"
        "  JOIN station s ON s.station_id = d.station_id"
        " WHERE r.reservation_id = %s",
        (reservation_id,),
    ).fetchone()
    (rid, status, draft_id, station_id, name, area, lat, lng,
     family, quantity, created_at, expires_at, cancelled_at, expired_at) = row
    return {
        "reservation_id": str(rid),
        "status": status,
        "draft_id": str(draft_id),
        "station": {
            "station_id": station_id,
            "name": name,
            "area_label": area,
            "coordinates": {"lat": float(lat), "lng": float(lng)},
        },
        "family_code": family,
        "quantity": quantity,
        "created_at": iso(created_at),
        "expires_at": iso(expires_at),
        "cancelled_at": iso(cancelled_at),
        "expired_at": iso(expired_at),
    }
