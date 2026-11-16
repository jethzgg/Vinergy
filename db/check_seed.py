"""Kiểm tra lược đồ, dữ liệu mẫu và việc đặt lại lặp lại được (WBS 1.1.3).

Chạy:  python db/check_seed.py

Kịch bản chỉ làm việc trên một cơ sở dữ liệu SQLite tạm trong bộ nhớ, tạo mới mỗi lần chạy.
Nó không kết nối tới cơ sở dữ liệu nào khác nên không thể xóa dữ liệu dùng chung hay dữ liệu thật.
Chỉ dùng thư viện chuẩn của Python 3.8+.

Các bước:
  1. Áp dụng các migration trong db/migrations theo thứ tự tên tệp, rồi nạp dữ liệu mẫu (seed.sql).
  2. Chạy validate_seed.sql: tọa độ, dịch vụ, khả năng tương thích, tồn kho.
  3. So từng trạm trong cơ sở dữ liệu với data/seed_stations_v0.json.
  4. Xác nhận nạp seed lần hai (không đặt lại) bị từ chối và không ghi gì.
  5. Lặp nhiều vòng: làm bẩn dữ liệu -> reset.sql + seed.sql -> trạng thái phải y hệt ban đầu.

Mã thoát 0 nếu mọi kiểm tra đạt, 1 nếu có kiểm tra không đạt.
"""
import json
import sqlite3
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent
JSON_PATH = DB_DIR.parent / "data" / "seed_stations_v0.json"
RESET_ROUNDS = 3
TABLES = [
    "battery_family", "app_user", "demo_origin", "station", "station_battery_stock",
    "station_charging_port", "user_session", "reservation_draft", "reservation", "idempotency_record",
]

failures = []


def report(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def run_file(db, name):
    db.executescript((DB_DIR / name).read_text(encoding="utf-8"))


def snapshot(db):
    """Toàn bộ nội dung mọi bảng, bỏ cột created_at vì nó là thời điểm nạp."""
    snap = {}
    for table in TABLES:
        cols = [r[1] for r in db.execute(f"PRAGMA table_info({table})") if r[1] != "created_at"]
        snap[table] = db.execute(f"SELECT {', '.join(cols)} FROM {table} ORDER BY {', '.join(cols)}").fetchall()
    return snap


def run_validation(db, label):
    sql = (DB_DIR / "validate_seed.sql").read_text(encoding="utf-8")
    rows = db.execute(sql).fetchall()
    bad = [f"{name}: mong đợi {exp}, thực tế {act}" for name, exp, act, result in rows if result != "PASS"]
    report(f"{label}: validate_seed.sql ({len(rows)} phép kiểm tra)", bool(rows) and not bad, "; ".join(bad))


def compare_with_json(db):
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    bad = []
    for st in data["stations"]:
        sid = st["station_id"]
        row = db.execute(
            "SELECT name, area_label, lat, lng, opening_status FROM station WHERE station_id = ?", (sid,)
        ).fetchone()
        expected = (st["name"], st["area_label"], st["coordinates"]["lat"], st["coordinates"]["lng"], st["opening_status"])
        batteries = dict(db.execute(
            "SELECT family_code, available_batteries FROM station_battery_stock WHERE station_id = ?", (sid,)))
        ports = dict(db.execute(
            "SELECT family_code, available_ports FROM station_charging_port WHERE station_id = ?", (sid,)))
        resources = db.execute(
            "SELECT service_type, family_code FROM v_station_resource WHERE station_id = ?", (sid,)).fetchall()
        if (row != expected
                or batteries != st["available_batteries_by_family"]
                or ports != st["available_charging_ports_by_family"]
                or {r[0] for r in resources} != set(st["services"])
                or {r[1] for r in resources} != set(st["supported_families"])):
            bad.append(sid)
    report(f"{len(data['stations'])} trạm trong CSDL khớp JSON (tọa độ, trạng thái, dịch vụ, nhóm, số lượng)",
           not bad, ", ".join(bad))
    families = db.execute("SELECT family_code, label, demo_vehicle_id FROM battery_family ORDER BY 1").fetchall()
    users = [r[0] for r in db.execute("SELECT user_id FROM app_user ORDER BY 1")]
    origins = {r[0]: {"lat": r[1], "lng": r[2]} for r in db.execute("SELECT origin_id, lat, lng FROM demo_origin")}
    report("Nhóm pin, người dùng demo và vị trí mẫu khớp JSON",
           families == sorted((f["family_code"], f["label"], f["demo_vehicle_id"]) for f in data["battery_families"])
           and users == sorted(data["demo_user_ids"]) and origins == data["origins"])


def dirty(db, round_no):
    """Mô phỏng dữ liệu còn lại sau một ca kiểm thử: phiên, bản nháp, đơn, tồn kho và trạng thái bị đổi."""
    t0, t1, t2 = "2026-11-16 10:00:00", "2026-11-16 10:05:00", "2026-11-16 10:15:00"
    db.execute("INSERT INTO user_session (session_token_hash, user_id, created_at, expires_at) VALUES (?, 'USER-A', ?, ?)",
               (f"{round_no:064d}", t0, t2))
    db.execute("INSERT INTO reservation_draft (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)"
               " VALUES ('d-used', 'USER-A', 'ST-01', 'FAM_A', 1, ?, ?)", (t0, t1))
    db.execute("INSERT INTO reservation_draft (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)"
               " VALUES ('d-abandoned', 'USER-B', 'ST-04', 'FAM_B', 1, ?, ?)", (t0, t1))
    db.execute("INSERT INTO reservation (reservation_id, draft_id, created_at, expires_at) VALUES ('r-1', 'd-used', ?, ?)",
               (t0, t2))
    db.execute("INSERT INTO idempotency_record (user_id, operation, idempotency_key, request_hash, reservation_id)"
               " VALUES ('USER-A', 'CONFIRM_RESERVATION', 'K1', ?, 'r-1')", ("a" * 64,))
    db.execute("UPDATE station_battery_stock SET available_batteries = available_batteries - 1"
               " WHERE station_id = 'ST-01' AND family_code = 'FAM_A'")
    db.execute("UPDATE station_battery_stock SET available_batteries = 0 WHERE family_code = 'FAM_A'")  # AE-18
    db.execute("UPDATE station SET lat = 21.0050, lng = 105.8435 WHERE station_id = 'ST-03'")  # AE-01
    db.execute("UPDATE station SET opening_status = 'CLOSED' WHERE station_id = 'ST-08'")
    db.execute("UPDATE station_charging_port SET available_ports = 99 WHERE station_id = 'ST-02'")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    print(f"SQLite {sqlite3.sqlite_version}, cơ sở dữ liệu tạm trong bộ nhớ")

    print("1-3. Lược đồ, dữ liệu mẫu và kiểm tra")
    migrations = sorted(p.name for p in (DB_DIR / "migrations").glob("*.sql"))
    for name in migrations:
        run_file(db, f"migrations/{name}")
    report(f"Áp dụng {len(migrations)} migration: {', '.join(migrations)}", bool(migrations))
    run_file(db, "seed.sql")
    run_validation(db, "Sau lần nạp đầu")
    compare_with_json(db)
    baseline = snapshot(db)

    print("4. Nạp seed lần hai khi chưa đặt lại")
    try:
        run_file(db, "seed.sql")
        rejected = False
    except sqlite3.IntegrityError:
        rejected = True
        if db.in_transaction:
            db.execute("ROLLBACK")
    report("seed.sql bị từ chối vì trùng khóa và không ghi gì", rejected and snapshot(db) == baseline)

    print(f"5. Đặt lại lặp lại được ({RESET_ROUNDS} vòng)")
    for round_no in range(1, RESET_ROUNDS + 1):
        dirty(db, round_no)
        changed = snapshot(db) != baseline
        run_file(db, "reset.sql")
        emptied = all(not rows for rows in snapshot(db).values())
        run_file(db, "seed.sql")
        report(f"Vòng {round_no}: dữ liệu bị làm bẩn, reset.sql xóa sạch, seed.sql khôi phục y hệt ban đầu",
               changed and emptied and snapshot(db) == baseline)
        run_validation(db, f"Vòng {round_no}")
    run_file(db, "reset.sql")
    run_file(db, "reset.sql")
    run_file(db, "seed.sql")
    report("reset.sql chạy hai lần liên tiếp rồi seed.sql vẫn cho trạng thái ban đầu", snapshot(db) == baseline)

    print()
    if failures:
        print(f"KHÔNG ĐẠT: {len(failures)} kiểm tra lỗi")
        return 1
    print("ĐẠT: mọi kiểm tra đều qua")
    return 0


if __name__ == "__main__":
    sys.exit(main())
