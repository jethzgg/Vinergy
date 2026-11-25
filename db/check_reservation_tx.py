"""Chạy thử giao dịch đặt pin của Reservation_Design.md §6 trên PostgreSQL thật (WBS 2.1.3).

Chạy (từ thư mục Vinergy, dùng Python của backend vì cần psycopg):
    backend\\.venv\\Scripts\\python db/check_reservation_tx.py

- Đọc TEST_DATABASE_URL từ biến môi trường hoặc tệp .env ở thư mục gốc repo.
- CHỈ chạy trên CSDL có tên kết thúc bằng "_test": mỗi kịch bản chạy db/reset.sql + db/seed.sql (XÓA dữ liệu).
- Đây là bản cài tham chiếu tối thiểu để kiểm chứng thiết kế (khóa, điều kiện, thứ tự bước), không phải
  mã của Reservation Service (2.2). Đồng hồ là tham số `now`, không dùng now() của DB (D-06).

Mã thoát 0 nếu mọi kiểm tra đạt, 1 nếu có kiểm tra không đạt.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from contextlib import contextmanager
from psycopg.conninfo import conninfo_to_dict

DB_DIR = Path(__file__).resolve().parent
ROOT = DB_DIR.parent
sys.path.insert(0, str(ROOT / "backend"))
# D-03: điều kiện đặt pin lúc tạo nháp dùng đúng hàm của Station Service (api_contracts §4.2).
from app.stations.domain import booking_eligibility  # noqa: E402
from app.stations.repository import SqlStationRepository  # noqa: E402
T0 = datetime(2026, 11, 25, 8, 0, tzinfo=timezone.utc)
DRAFT_TTL = timedelta(minutes=5)       # DRAFT_TTL_MINUTES (đề xuất M1, SRS §8, 2.1.1)
HOLD = timedelta(minutes=15)           # RESERVATION_HOLD_MINUTES (đề xuất M1, SRS §8, 2.1.1)
OP = "CONFIRM_RESERVATION"

failures: list = []


class Reject(Exception):
    def __init__(self, status: int, code: str, reason: str | None = None):
        super().__init__(code)
        self.status, self.code, self.reason = status, code, reason


# ---------------------------------------------------------------------------
# Bản cài tham chiếu các giao dịch §6.1, §6.2, §6.4, §6.5
# ---------------------------------------------------------------------------

def station_repo(conn) -> SqlStationRepository:
    @contextmanager
    def connect():
        yield conn

    return SqlStationRepository(connect, placeholder="%s")


def create_draft(conn, user: str, station: str, family: str, now: datetime) -> str:
    """§6.1. Trạm phải đủ điều kiện lúc tạo nháp (D-03), nhưng KHÔNG trừ tồn kho."""
    found = station_repo(conn).get(station)
    if found is None:
        raise Reject(404, "STATION_NOT_FOUND")
    eligible, reason = booking_eligibility(found, family)
    if not eligible:
        raise Reject(409, "STATION_NOT_ELIGIBLE", reason)
    draft_id = str(uuid.uuid4())
    with conn.transaction():
        conn.execute(
            "INSERT INTO reservation_draft (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)"
            " VALUES (%s, %s, %s, %s, 1, %s, %s)",
            (draft_id, user, station, family, now, now + DRAFT_TTL),
        )
    return draft_id


def request_hash(body: dict) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _expire_one(conn, reservation_id: str, now: datetime) -> None:
    conn.execute(
        "WITH e AS (UPDATE reservation SET status = 'EXPIRED', expired_at = %s"
        "  WHERE reservation_id = %s AND status = 'ACTIVE' AND %s >= expires_at RETURNING draft_id)"
        " UPDATE station_battery_stock s SET available_batteries = s.available_batteries + 1"
        "   FROM e JOIN reservation_draft d ON d.draft_id = e.draft_id"
        "  WHERE s.station_id = d.station_id AND s.family_code = d.family_code",
        (now, reservation_id, now),
    )


def confirm(conn, user: str, key: str, body: dict, now: datetime, pause_after_stock: float = 0.0,
            hold: timedelta = HOLD) -> dict:
    """§6.2. Trả {'status': 201|200, 'reservation_id'}; lỗi nghiệp vụ ném Reject (giao dịch rollback).

    `hold` là RESERVATION_HOLD_MINUTES đang cấu hình (AE-10b: đổi cấu hình thì hạn đơn mới dịch theo)."""
    h = request_hash(body)
    with conn.transaction():
        conn.execute("SET LOCAL lock_timeout = '5s'")
        try:
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{user}|{OP}|{key}",))
        except psycopg.errors.LockNotAvailable:
            raise Reject(409, "REQUEST_IN_PROGRESS") from None
        # Thời gian chờ chỉ áp dụng cho advisory lock; chờ khóa dòng sau đó không bị coi là "đang xử lý".
        conn.execute("SET LOCAL lock_timeout = 0")

        row = conn.execute(
            "SELECT request_hash, reservation_id FROM idempotency_record"
            " WHERE user_id = %s AND operation = %s AND idempotency_key = %s",
            (user, OP, key),
        ).fetchone()
        if row:
            if row[0] != h:
                raise Reject(409, "IDEMPOTENCY_KEY_REUSED")
            _expire_one(conn, str(row[1]), now)
            return {"status": 200, "reservation_id": str(row[1])}

        draft = conn.execute(
            "SELECT station_id, family_code, quantity, expires_at FROM reservation_draft"
            " WHERE draft_id = %s AND user_id = %s FOR UPDATE",
            (body["draft_id"], user),
        ).fetchone()
        if draft is None:
            raise Reject(404, "DRAFT_NOT_FOUND")
        if conn.execute("SELECT 1 FROM reservation WHERE draft_id = %s", (body["draft_id"],)).fetchone():
            raise Reject(409, "DRAFT_ALREADY_USED")
        station, family, quantity, draft_expires = draft
        if (body["station_id"], body["family_code"], body["quantity"]) != (station, family, quantity):
            raise Reject(409, "DRAFT_STALE", "CONTENT_MISMATCH")
        if now >= draft_expires:
            raise Reject(409, "DRAFT_STALE", "DRAFT_EXPIRED")

        conn.execute("SELECT station_id FROM station WHERE station_id = %s FOR SHARE", (station,))
        conn.execute(
            "SELECT family_code FROM station_battery_stock WHERE station_id = %s ORDER BY family_code FOR UPDATE",
            (station,),
        ).fetchall()
        eligible, reason = booking_eligibility(station_repo(conn).get(station), family)
        if not eligible:
            raise Reject(409, "STATION_NOT_ELIGIBLE", reason)

        cur = conn.execute(
            "UPDATE station_battery_stock SET available_batteries = available_batteries - 1"
            " WHERE station_id = %s AND family_code = %s AND available_batteries >= 1",
            (station, family),
        )
        if cur.rowcount != 1:
            raise Reject(409, "STATION_NOT_ELIGIBLE", "OUT_OF_STOCK")
        if pause_after_stock:
            time.sleep(pause_after_stock)  # giữ khóa dòng để tạo tranh chấp có kiểm soát

        rid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO reservation (reservation_id, draft_id, status, created_at, expires_at)"
            " VALUES (%s, %s, 'ACTIVE', %s, %s)",
            (rid, body["draft_id"], now, now + hold),
        )
        conn.execute(
            "INSERT INTO idempotency_record (user_id, operation, idempotency_key, request_hash, reservation_id, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (user, OP, key, h, rid, now),
        )
        return {"status": 201, "reservation_id": rid}


def read_reservation(conn, user: str, reservation_id: str, now: datetime) -> str:
    """§6.4 phần đối soát: đọc đơn của chủ sở hữu, chuyển EXPIRED nếu đã quá hạn."""
    with conn.transaction():
        row = conn.execute(
            "SELECT 1 FROM reservation r JOIN reservation_draft d ON d.draft_id = r.draft_id"
            " WHERE r.reservation_id = %s AND d.user_id = %s FOR UPDATE OF r",
            (reservation_id, user),
        ).fetchone()
        if row is None:
            raise Reject(404, "RESERVATION_NOT_FOUND")
        _expire_one(conn, reservation_id, now)
        return conn.execute("SELECT status FROM reservation WHERE reservation_id = %s", (reservation_id,)).fetchone()[0]


def cancel(conn, user: str, reservation_id: str, now: datetime, pause_after_lock: float = 0.0) -> str:
    """§6.4. Trả trạng thái sau thao tác; đơn không có/của người khác ném Reject 404."""
    with conn.transaction():
        row = conn.execute(
            "SELECT d.station_id, d.family_code FROM reservation r"
            " JOIN reservation_draft d ON d.draft_id = r.draft_id"
            " WHERE r.reservation_id = %s AND d.user_id = %s FOR UPDATE OF r",
            (reservation_id, user),
        ).fetchone()
        if row is None:
            raise Reject(404, "RESERVATION_NOT_FOUND")
        if pause_after_lock:
            time.sleep(pause_after_lock)
        changed = conn.execute(
            "UPDATE reservation SET status = 'EXPIRED', expired_at = %s"
            " WHERE reservation_id = %s AND status = 'ACTIVE' AND %s >= expires_at",
            (now, reservation_id, now),
        ).rowcount
        if changed == 0:
            changed = conn.execute(
                "UPDATE reservation SET status = 'CANCELLED', cancelled_at = %s"
                " WHERE reservation_id = %s AND status = 'ACTIVE' AND %s < expires_at",
                (now, reservation_id, now),
            ).rowcount
        if changed == 1:
            conn.execute(
                "UPDATE station_battery_stock SET available_batteries = available_batteries + 1"
                " WHERE station_id = %s AND family_code = %s",
                row,
            )
        return conn.execute("SELECT status FROM reservation WHERE reservation_id = %s", (reservation_id,)).fetchone()[0]


def sweep(conn, now: datetime) -> None:
    """§6.5. Một câu lệnh, hoàn pin đúng số đơn vừa chuyển EXPIRED. Chỉ một worker chạy mỗi lượt."""
    with conn.transaction():
        if not conn.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('EXPIRY_WORKER', 0))").fetchone()[0]:
            return
        conn.execute(
            "WITH expired AS ("
            "  UPDATE reservation SET status = 'EXPIRED', expired_at = %s"
            "   WHERE status = 'ACTIVE' AND expires_at <= %s RETURNING draft_id"
            "), released AS ("
            "  SELECT d.station_id, d.family_code, count(*) AS n"
            "    FROM expired e JOIN reservation_draft d ON d.draft_id = e.draft_id"
            "   GROUP BY d.station_id, d.family_code"
            ") UPDATE station_battery_stock s SET available_batteries = s.available_batteries + released.n"
            "    FROM released WHERE s.station_id = released.station_id AND s.family_code = released.family_code",
            (now, now),
        )


# ---------------------------------------------------------------------------
# Tiện ích kiểm thử
# ---------------------------------------------------------------------------

def report(name: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def reset(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c:
        if c.execute("SELECT to_regclass('public.station')").fetchone()[0] is None:
            for m in sorted((DB_DIR / "migrations").glob("*.sql")):
                c.execute(m.read_text(encoding="utf-8"))
        else:
            if c.execute("SELECT 1 FROM pg_constraint WHERE conrelid = 'reservation_draft'::regclass"
                         " AND conname = 'fk_draft_battery_stock'").fetchone():
                c.execute((DB_DIR / "migrations" / "002_reservation_stock.sql").read_text(encoding="utf-8"))
            c.execute((DB_DIR / "reset.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "seed.sql").read_text(encoding="utf-8"))


def stock(conn, station="ST-01", family="FAM_A") -> int:
    return conn.execute(
        "SELECT available_batteries FROM station_battery_stock WHERE station_id = %s AND family_code = %s",
        (station, family),
    ).fetchone()[0]


def count(conn, sql: str, args=()) -> int:
    return conn.execute(sql, args).fetchone()[0]


def body_for(draft_id: str, station="ST-01", family="FAM_A") -> dict:
    return {"draft_id": draft_id, "station_id": station, "family_code": family, "quantity": 1}


def attempt(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Reject as exc:
        return exc


def run_parallel(url: str, calls: list) -> list:
    """Chạy mỗi lời gọi trên một kết nối riêng, xuất phát cùng lúc."""
    results = [None] * len(calls)
    barrier = threading.Barrier(len(calls))

    def worker(i, fn, args, kwargs):
        with psycopg.connect(url, autocommit=True) as c:
            barrier.wait()
            results[i] = attempt(fn, c, *args, **kwargs)

    threads = [threading.Thread(target=worker, args=(i, *call)) for i, call in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def code_of(result) -> str:
    return result.code if isinstance(result, Reject) else str(result.get("status") if isinstance(result, dict) else result)


# ---------------------------------------------------------------------------
# Kịch bản
# ---------------------------------------------------------------------------

def scenarios(url: str) -> None:
    def fresh():
        reset(url)
        return psycopg.connect(url, autocommit=True)

    print("AE-09 / AE-10: bản nháp không giữ pin; xác nhận trừ đúng 1")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        report("AE-09 tạo bản nháp không đổi tồn kho (6)", stock(c) == 6)
        r = confirm(c, "USER-A", "key-ae10-000000001", body_for(d), T0 + timedelta(minutes=1))
        report("AE-10 xác nhận trả 201", r["status"] == 201)
        report("AE-10 tồn kho A 6 -> 5, B không đổi", (stock(c), stock(c, family="FAM_B")) == (5, 4))
        report("AE-10 cổng sạc không đổi",
               count(c, "SELECT available_ports FROM station_charging_port WHERE station_id='ST-01' AND family_code='FAM_A'") == 3)

        print("AE-11 / AE-12: gửi lại và dùng lại khóa")
        late = T0 + timedelta(minutes=10)  # nháp đã hết hạn (08:05), đơn còn giữ đến 08:16
        again = confirm(c, "USER-A", "key-ae10-000000001", body_for(d), late)
        report("AE-11 gửi lại sau khi bản nháp hết hạn trả 200 cùng đơn",
               again == {"status": 200, "reservation_id": r["reservation_id"]})
        report("AE-11 gửi lại không trừ thêm (5)", stock(c) == 5)
        d2 = create_draft(c, "USER-A", "ST-03", "FAM_A", T0)
        reused = attempt(confirm, c, "USER-A", "key-ae10-000000001", body_for(d2, "ST-03"), T0)
        report("AE-12 cùng khóa khác body -> IDEMPOTENCY_KEY_REUSED", code_of(reused) == "IDEMPOTENCY_KEY_REUSED")
        report("AE-12 không đổi tồn kho ST-03 (8)", stock(c, "ST-03") == 8)
        other_user = attempt(confirm, c, "USER-B", "key-ae10-000000001", body_for(d), T0)
        report("AE-14 khóa thuộc phạm vi người dùng: USER-B dùng bản nháp của A -> DRAFT_NOT_FOUND",
               code_of(other_user) == "DRAFT_NOT_FOUND")

        print("AE-17: bản nháp đã dùng, hết hạn, lệch nội dung")
        used = attempt(confirm, c, "USER-A", "key-ae17-k2-0000001", body_for(d), T0 + timedelta(minutes=2))
        report("AE-17 khóa mới trên bản nháp đã dùng -> DRAFT_ALREADY_USED", code_of(used) == "DRAFT_ALREADY_USED")
        mismatch = attempt(confirm, c, "USER-A", "key-ae17-mismatch01", body_for(d2, "ST-03", "FAM_B"), T0)
        report("AE-17 body lệch bản nháp -> DRAFT_STALE/CONTENT_MISMATCH",
               isinstance(mismatch, Reject) and (mismatch.code, mismatch.reason) == ("DRAFT_STALE", "CONTENT_MISMATCH"))
        expired = attempt(confirm, c, "USER-A", "key-ae17-expired001", body_for(d2, "ST-03"), T0 + DRAFT_TTL)
        report("AE-09a / AE-17 xác nhận đúng lúc nháp hết hạn (T0 + 5 phút) -> DRAFT_STALE/DRAFT_EXPIRED",
               isinstance(expired, Reject) and expired.reason == "DRAFT_EXPIRED")
        report("AE-17 không tạo đơn, tồn kho ST-03 vẫn 8",
               stock(c, "ST-03") == 8 and count(c, "SELECT count(*) FROM reservation") == 1)
        retry = confirm(c, "USER-A", "key-ae17-expired001", body_for(create_draft(c, "USER-A", "ST-03", "FAM_A", T0 + DRAFT_TTL), "ST-03"), T0 + DRAFT_TTL)
        report("Yêu cầu bị từ chối không giữ khóa: thử lại cùng khóa với bản nháp mới -> 201", retry["status"] == 201)

    print("AE-10: trạm đổi trạng thái trước xác nhận")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        c.execute("UPDATE station SET opening_status = 'MAINTENANCE' WHERE station_id = 'ST-01'")
        r = attempt(confirm, c, "USER-A", "key-maint-00000001", body_for(d), T0)
        report("AE-10 trạm bảo trì -> STATION_NOT_ELIGIBLE/STATION_MAINTENANCE",
               isinstance(r, Reject) and r.reason == "STATION_MAINTENANCE")
        report("AE-10 không trừ tồn kho (6)", stock(c) == 6)

    print("AE-11 (đồng thời): hai yêu cầu cùng khóa, cùng body")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        res = run_parallel(url, [(confirm, ("USER-A", "key-same-000000001", body_for(d), T0), {"pause_after_stock": 0.3})] * 2)
        ids = {x["reservation_id"] for x in res if isinstance(x, dict)}
        report("Hai kết quả đều thành công", all(isinstance(x, dict) for x in res), str([code_of(x) for x in res]))
        report("Một 201 và một 200", sorted(code_of(x) for x in res) == ["200", "201"])
        report("Cả hai chỉ cùng một đơn", len(ids) == 1)
        report("Một đơn, tồn kho 6 -> 5", count(c, "SELECT count(*) FROM reservation") == 1 and stock(c) == 5)

    print("AE-17 (đồng thời): cùng bản nháp, hai khóa K1/K2")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        res = run_parallel(url, [
            (confirm, ("USER-A", "key-k1-00000000001", body_for(d), T0), {"pause_after_stock": 0.3}),
            (confirm, ("USER-A", "key-k2-00000000001", body_for(d), T0), {"pause_after_stock": 0.3}),
        ])
        report("Một 201, một DRAFT_ALREADY_USED", sorted(code_of(x) for x in res) == ["201", "DRAFT_ALREADY_USED"],
               str([code_of(x) for x in res]))
        report("Một đơn, tồn kho 5", count(c, "SELECT count(*) FROM reservation") == 1 and stock(c) == 5)

    print("AE-13: hai người tranh viên pin cuối")
    for round_no in range(1, 4):
        with fresh() as c:
            c.execute("UPDATE station_battery_stock SET available_batteries = 1 WHERE station_id='ST-01' AND family_code='FAM_A'")
            da = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
            db_ = create_draft(c, "USER-B", "ST-01", "FAM_A", T0)
            res = run_parallel(url, [
                (confirm, ("USER-A", "key-race-a-0000001", body_for(da), T0), {"pause_after_stock": 0.2}),
                (confirm, ("USER-B", "key-race-b-0000001", body_for(db_), T0), {"pause_after_stock": 0.2}),
            ])
            codes = sorted(code_of(x) for x in res)
            report(f"Vòng {round_no}: đúng một 201, một STATION_NOT_ELIGIBLE",
                   codes == ["201", "STATION_NOT_ELIGIBLE"], str(codes))
            loser = next((x for x in res if isinstance(x, Reject)), None)
            report(f"Vòng {round_no}: bên thua có reason OUT_OF_STOCK", loser is not None and loser.reason == "OUT_OF_STOCK")
            report(f"Vòng {round_no}: tồn kho 0, đúng một đơn ACTIVE",
                   stock(c) == 0 and count(c, "SELECT count(*) FROM reservation WHERE status='ACTIVE'") == 1)

    print("AE-14 / AE-15: quyền sở hữu và hủy lặp lại")
    with fresh() as c:
        rid = confirm(c, "USER-A", "key-cancel-0000001", body_for(create_draft(c, "USER-A", "ST-01", "FAM_A", T0)), T0)["reservation_id"]
        other = attempt(cancel, c, "USER-B", rid, T0 + timedelta(minutes=5))
        report("AE-14 USER-B hủy đơn của A -> RESERVATION_NOT_FOUND", code_of(other) == "RESERVATION_NOT_FOUND")
        report("AE-14 tồn kho vẫn 5", stock(c) == 5)
        first = cancel(c, "USER-A", rid, T0 + timedelta(minutes=5))
        second = cancel(c, "USER-A", rid, T0 + timedelta(minutes=6))
        report("AE-15 hủy -> CANCELLED, hủy lại vẫn CANCELLED", (first, second) == ("CANCELLED", "CANCELLED"))
        report("AE-15 tồn kho về 6 đúng một lần (không thành 7)", stock(c) == 6)
        sweep(c, T0 + timedelta(hours=1))
        report("AE-16a worker sau đó không đổi gì", stock(c) == 6 and
               count(c, "SELECT count(*) FROM reservation WHERE status='CANCELLED'") == 1)
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0 + timedelta(hours=1))
        reuse = attempt(confirm, c, "USER-A", "key-cancel-0000002", body_for(d), T0 + timedelta(hours=1))
        report("Đơn đã hủy không chặn bản nháp mới", code_of(reuse) == "201")

    print("AE-16b: hủy tại hoặc sau thời hạn")
    with fresh() as c:
        rid = confirm(c, "USER-A", "key-ae16b-00000001", body_for(create_draft(c, "USER-A", "ST-01", "FAM_A", T0)), T0)["reservation_id"]
        at_e = cancel(c, "USER-A", rid, T0 + HOLD)
        report("Hủy đúng lúc E -> EXPIRED, không phải CANCELLED", at_e == "EXPIRED")
        report("Tồn kho về 6", stock(c) == 6)
        report("expired_at = E", count(c, "SELECT count(*) FROM reservation WHERE expired_at = expires_at") == 1)
        before_e = confirm(c, "USER-A", "key-ae16b-00000002",
                           body_for(create_draft(c, "USER-A", "ST-01", "FAM_A", T0)), T0)["reservation_id"]
        just_before = cancel(c, "USER-A", before_e, T0 + HOLD - timedelta(microseconds=1))
        report("Hủy trước E 1 µs -> CANCELLED", just_before == "CANCELLED")

    print("AE-16d: hủy và worker chạy đua quanh E (lặp 5 lần)")
    for round_no in range(1, 6):
        with fresh() as c:
            rid = confirm(c, "USER-A", f"key-ae16d-{round_no:08d}", body_for(create_draft(c, "USER-A", "ST-01", "FAM_A", T0)), T0)["reservation_id"]
            cancel_time = T0 + HOLD - timedelta(seconds=1) if round_no % 2 else T0 + HOLD + timedelta(seconds=1)
            res = run_parallel(url, [
                (cancel, ("USER-A", rid, cancel_time), {"pause_after_lock": 0.2}),
                (sweep, (T0 + HOLD + timedelta(seconds=5),), {}),
                (cancel, ("USER-A", rid, cancel_time), {}),
            ])
            final = count(c, "SELECT count(*) FROM reservation WHERE status <> 'ACTIVE'")
            report(f"Vòng {round_no}: tồn kho về 6 đúng một lần, đơn đã kết thúc",
                   stock(c) == 6 and final == 1, f"kết quả={[code_of(x) for x in res]}, tồn kho={stock(c)}")

    print("AE-16c / worker: hoàn đúng số đơn quá hạn của nhiều trạm")
    with fresh() as c:
        for i, (user, st) in enumerate([("USER-A", "ST-01"), ("USER-B", "ST-01"), ("USER-A", "ST-03")]):
            confirm(c, user, f"key-sweep-{i:08d}", body_for(create_draft(c, user, st, "FAM_A", T0), st), T0)
        active_late = confirm(c, "USER-A", "key-sweep-late0001",
                              body_for(create_draft(c, "USER-A", "ST-06", "FAM_A", T0 + timedelta(minutes=5)), "ST-06"),
                              T0 + timedelta(minutes=5))
        sweep(c, T0 + HOLD + timedelta(seconds=30))
        report("ST-01: 6 -> 4 -> 6, ST-03: 8 -> 7 -> 8", (stock(c), stock(c, "ST-03")) == (6, 8))
        report("Đơn chưa đến hạn vẫn ACTIVE, ST-06 vẫn 4",
               stock(c, "ST-06") == 4 and
               count(c, "SELECT count(*) FROM reservation WHERE reservation_id = %s AND status='ACTIVE'", (active_late["reservation_id"],)) == 1)
        sweep(c, T0 + HOLD + timedelta(seconds=60))
        report("Chạy worker lần nữa không hoàn thêm", (stock(c), stock(c, "ST-03")) == (6, 8))
        report("Tồn kho không bao giờ âm (CHECK)",
               count(c, "SELECT count(*) FROM station_battery_stock WHERE available_batteries < 0") == 0)

    print("AE-09a / AE-10b: hạn nháp 5 phút, hạn giữ 15 phút tính từ lúc xác nhận")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        report("AE-09a nháp hết hạn đúng T0 + 5 phút, kho 6, 0 đơn",
               count(c, "SELECT count(*) FROM reservation_draft WHERE expires_at = %s", (T0 + DRAFT_TTL,)) == 1
               and stock(c) == 6 and count(c, "SELECT count(*) FROM reservation") == 0)
        rid = confirm(c, "USER-A", "key-ae10b-00000001", body_for(d), T0 + timedelta(minutes=4))["reservation_id"]
        report("AE-10b xác nhận lúc T0 + 4 phút -> hạn giữ T0 + 19 phút",
               count(c, "SELECT count(*) FROM reservation WHERE reservation_id = %s AND expires_at = %s",
                     (rid, T0 + timedelta(minutes=19))) == 1)
        at_5 = read_reservation(c, "USER-A", rid, T0 + timedelta(minutes=5))
        report("AE-10b lúc T0 + 5 phút: nháp hết hạn nhưng đơn vẫn ACTIVE, kho 5", at_5 == "ACTIVE" and stock(c) == 5)
        at_19 = read_reservation(c, "USER-A", rid, T0 + timedelta(minutes=19))
        report("AE-10b chủ đơn đọc đúng T0 + 19 phút -> EXPIRED, kho về 6", at_19 == "EXPIRED" and stock(c) == 6)
        stranger = attempt(read_reservation, c, "USER-B", rid, T0 + timedelta(minutes=20))
        report("AE-14 USER-B đọc đơn của A -> RESERVATION_NOT_FOUND", code_of(stranger) == "RESERVATION_NOT_FOUND")

    print("AE-10b: đổi thời lượng giữ trong cấu hình (20 phút thay cho 15)")
    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        rid = confirm(c, "USER-A", "key-ae10b-hold20-01", body_for(d), T0 + timedelta(minutes=4),
                      hold=timedelta(minutes=20))["reservation_id"]
        report("AE-10b cấu hình giữ 20 phút: xác nhận T0 + 4 -> hạn T0 + 24 (dịch 5 phút so với 15)",
               count(c, "SELECT count(*) FROM reservation WHERE reservation_id = %s AND expires_at = %s",
                     (rid, T0 + timedelta(minutes=24))) == 1)
        at_19 = read_reservation(c, "USER-A", rid, T0 + timedelta(minutes=19))
        report("AE-10b cấu hình 20 phút: lúc T0 + 19 đơn vẫn ACTIVE, kho 5", at_19 == "ACTIVE" and stock(c) == 5)

    print("AE-10a: năm trạm không đủ điều kiện, lúc tạo nháp")
    with fresh() as c:
        for station, reason in [("ST-02", "CHARGING_ONLY"), ("ST-04", "UNSUPPORTED_FAMILY"), ("ST-09", "STATION_CLOSED"),
                                ("ST-13", "STATION_MAINTENANCE"), ("ST-05", "OUT_OF_STOCK")]:
            before = (count(c, "SELECT coalesce(sum(available_batteries), 0) FROM station_battery_stock"),
                      count(c, "SELECT count(*) FROM reservation_draft"))
            r = attempt(create_draft, c, "USER-A", station, "FAM_A", T0)
            after = (count(c, "SELECT coalesce(sum(available_batteries), 0) FROM station_battery_stock"),
                     count(c, "SELECT count(*) FROM reservation_draft"))
            report(f"AE-10a {station} -> STATION_NOT_ELIGIBLE/{reason}, không đổi nháp/kho",
                   isinstance(r, Reject) and (r.code, r.reason) == ("STATION_NOT_ELIGIBLE", reason) and before == after,
                   "" if isinstance(r, Reject) else "đã tạo nháp")

    print("AE-10a: trạm đổi điều kiện sau khi tạo nháp, lúc xác nhận")
    for label, changes, reason in [
        ("đóng cửa", ["UPDATE station SET opening_status = 'CLOSED' WHERE station_id = 'ST-01'"], "STATION_CLOSED"),
        ("bảo trì, kho 0", ["UPDATE station SET opening_status = 'MAINTENANCE' WHERE station_id = 'ST-01'",
                            "UPDATE station_battery_stock SET available_batteries = 0"
                            " WHERE station_id = 'ST-01' AND family_code = 'FAM_A'"], "STATION_MAINTENANCE"),
        ("hết pin A", ["UPDATE station_battery_stock SET available_batteries = 0"
                       " WHERE station_id = 'ST-01' AND family_code = 'FAM_A'"], "OUT_OF_STOCK"),
    ]:
        with fresh() as c:
            d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
            for sql in changes:
                c.execute(sql)
            before = (stock(c), count(c, "SELECT count(*) FROM reservation"))
            r = attempt(confirm, c, "USER-A", f"key-ae10a-{reason[:9]:0<9}", body_for(d), T0 + timedelta(minutes=1))
            report(f"AE-10a ST-01 {label} -> {reason}, đơn/kho thay đổi 0",
                   isinstance(r, Reject) and r.reason == reason
                   and (stock(c), count(c, "SELECT count(*) FROM reservation")) == before)
    for station, reason in [("ST-02", "CHARGING_ONLY"), ("ST-04", "UNSUPPORTED_FAMILY")]:
        with fresh() as c:
            c.execute("INSERT INTO station_battery_stock (station_id, family_code, available_batteries)"
                      " VALUES (%s, 'FAM_A', 1)", (station,))
            d = create_draft(c, "USER-A", station, "FAM_A", T0)
            c.execute("DELETE FROM station_battery_stock WHERE station_id = %s AND family_code = 'FAM_A'", (station,))
            remaining = count(c, "SELECT sum(available_batteries) FROM station_battery_stock")
            result = attempt(confirm, c, "USER-A", "key-ae10a-change-01", body_for(d, station), T0)
            report(f"AE-10a {station} cấu hình trạm thay đổi -> 409 {reason}, đơn/kho không đổi",
                   isinstance(result, Reject) and (result.status, result.code, result.reason) ==
                   (409, "STATION_NOT_ELIGIBLE", reason) and count(c, "SELECT count(*) FROM reservation") == 0
                   and count(c, "SELECT sum(available_batteries) FROM station_battery_stock") == remaining)

    with fresh() as c:
        d = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        rid = confirm(c, "USER-A", "key-ae10a-active-01", body_for(d), T0)["reservation_id"]
        remove_stock = "DELETE FROM station_battery_stock WHERE station_id = 'ST-01' AND family_code = 'FAM_A'"
        try:
            c.execute(remove_stock)
        except psycopg.errors.ForeignKeyViolation:
            report("Đơn ACTIVE bảo vệ dòng kho cho đến khi hoàn pin", stock(c) == 5)
        else:
            report("Đơn ACTIVE bảo vệ dòng kho cho đến khi hoàn pin", False)
        cancel(c, "USER-A", rid, T0 + timedelta(minutes=1))
        report("Sau khi hủy và hoàn pin, có thể bỏ hỗ trợ nhóm", stock(c) == 6 and c.execute(remove_stock).rowcount == 1)

    print("AE-11a: hai lần đặt độc lập của cùng người (không giới hạn đơn ACTIVE)")
    with fresh() as c:
        d1 = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        d2 = create_draft(c, "USER-A", "ST-01", "FAM_A", T0)
        r1 = confirm(c, "USER-A", "key-ae11a-00000001", body_for(d1), T0 + timedelta(minutes=1))
        r2 = confirm(c, "USER-A", "key-ae11a-00000002", body_for(d2), T0 + timedelta(minutes=1))
        report("AE-11a hai đơn ACTIVE khác mã, kho 6 -> 4",
               r1["reservation_id"] != r2["reservation_id"] and stock(c) == 4
               and count(c, "SELECT count(*) FROM reservation WHERE status = 'ACTIVE'") == 2)
        again = confirm(c, "USER-A", "key-ae11a-00000002", body_for(d2), T0 + timedelta(minutes=2))
        report("AE-11a gửi lại xác nhận thứ hai trả đúng đơn thứ hai, kho vẫn 4",
               again == {"status": 200, "reservation_id": r2["reservation_id"]} and stock(c) == 4)

    print("Đặt lại dữ liệu sau kiểm thử")
    reset(url)
    with psycopg.connect(url) as c:
        rows = c.execute((DB_DIR / "validate_seed.sql").read_text(encoding="utf-8")).fetchall()
    report(f"validate_seed.sql sau reset ({len(rows)} phép kiểm tra)", bool(rows) and all(r[-1] == "PASS" for r in rows))


def load_url() -> str:
    url = os.getenv("TEST_DATABASE_URL", "").strip()
    env = ROOT / ".env"
    if not url and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("TEST_DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    return url


def main() -> int:
    url = load_url()
    if not url:
        print("Thiếu TEST_DATABASE_URL (biến môi trường hoặc .env).")
        return 1
    dbname = conninfo_to_dict(url).get("dbname", "")
    if not dbname.endswith("_test"):
        print(f"Từ chối chạy trên CSDL {dbname!r}: tên phải kết thúc bằng _test.")
        return 1
    print(f"CSDL: {dbname}")
    scenarios(url)
    print()
    print("ĐẠT: mọi kiểm tra đều qua" if not failures else f"KHÔNG ĐẠT: {len(failures)} kiểm tra")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
