"""Reservation Service: drafts and atomic confirmation (WBS 2.2.1, api_contracts §6.3–§6.7).

Draft creation holds no stock (BR-06). Confirmation is one PostgreSQL transaction that
re-checks the station, takes exactly one battery with a conditional UPDATE and records the
order together with its idempotency key; every rejection rolls back (BR-07, BR-08).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Callable, Optional

import psycopg

from app import demo_session
from app.errors import ApiError
from app.reservations import store
from app.reservations.config import ReservationSettings, utc_now
from app.reservations.validation import ConfirmRequest, DraftRequest
from app.stations.domain import Station, booking_eligibility
from app.stations.service import StationService
from app.stations.validation import SearchQuery


def station_not_eligible(reason: str) -> ApiError:
    messages = {
        "CHARGING_ONLY": "Trạm chỉ có dịch vụ sạc, không đổi pin.",
        "UNSUPPORTED_FAMILY": "Trạm không hỗ trợ nhóm pin đã chọn.",
        "STATION_CLOSED": "Trạm đang đóng cửa.",
        "STATION_MAINTENANCE": "Trạm đang bảo trì.",
        "OUT_OF_STOCK": "Trạm đã hết pin khả dụng của nhóm đã chọn.",
    }
    return ApiError(
        409,
        "STATION_NOT_ELIGIBLE",
        "Trạm không đủ điều kiện đặt pin.",
        [{"field": "station_id", "reason": reason, "message": messages[reason]}],
    )


DRAFT_SNAPSHOT_ATTEMPTS = 3


def draft_not_found() -> ApiError:
    return ApiError(404, "DRAFT_NOT_FOUND", "Không tìm thấy bản nháp.")


def _draft_status(now: datetime, expires_at: datetime, reservation_id) -> str:
    if reservation_id is not None:
        return "USED"  # USED wins over EXPIRED (Reservation_Design §3.2)
    return "EXPIRED" if now >= expires_at else "OPEN"


class ReservationService:
    def __init__(
        self,
        database_url: str,
        settings: Optional[ReservationSettings] = None,
        session_secret: str = "",
        clock: Callable[[], datetime] = utc_now,
    ):
        demo_session.require_usable_secret(session_secret)  # fail fast on a missing/sample key
        self._url = database_url
        self.settings = settings or ReservationSettings()
        self._secret = session_secret
        self.clock = clock

    def _connect(self):
        return psycopg.connect(self._url, autocommit=True, connect_timeout=5)

    # --- session (§3, Reservation_Design §4) -------------------------------------------

    def authenticate(self, raw_sid: Optional[str]) -> str:
        with self._connect() as conn:
            return demo_session.resolve_user(conn, self._secret, raw_sid, self.clock())

    def check_csrf(self, raw_sid: str, token: Optional[str]) -> None:
        demo_session.require_csrf(self._secret, raw_sid, token)

    # --- drafts (§6.3–§6.5) ----------------------------------------------------------

    def create_draft(self, user_id: str, req: DraftRequest) -> dict:
        """Pick the station, check it is bookable right now, store an immutable draft. Stock unchanged.

        Choosing the station, building the response and inserting the draft share one
        REPEATABLE READ snapshot, so a draft never shows a station that was ineligible in
        the data it was chosen from. Stock may still move afterwards: the draft holds
        nothing and confirmation re-checks it on locked rows (BR-06, Reservation_Design §6.2).
        """
        for attempt in range(DRAFT_SNAPSHOT_ATTEMPTS):
            try:
                return self._create_draft_once(user_id, req)
            except psycopg.errors.SerializationFailure:
                # A row this snapshot read changed before the draft's FK check. Retry on a newer snapshot.
                if attempt == DRAFT_SNAPSHOT_ATTEMPTS - 1:
                    raise

    def _create_draft_once(self, user_id: str, req: DraftRequest) -> dict:
        now = self.clock()
        with self._connect() as conn, conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            repo = store.station_repository_in_tx(conn)
            if req.station_id is not None:
                station = repo.get(req.station_id)
                if station is None:
                    raise ApiError.station_not_found()
                eligible, reason = booking_eligibility(station, req.family_code)
                if not eligible:
                    raise station_not_eligible(reason)
                distance_km = distance_display = None
            else:
                lat, lng, radius_km = req.nearest
                result = StationService(repo).search(
                    SearchQuery(lat, lng, "SWAPPING", req.family_code, True, radius_km)
                )
                pick = next((s for s in result["stations"] if s["booking_eligible"]), None)
                if pick is None:
                    raise ApiError(
                        409,
                        "NO_ELIGIBLE_STATION",
                        "Không có trạm đổi pin nào đủ điều kiện trong phạm vi đã chọn.",
                    )
                station = repo.get(pick["station_id"])  # same snapshot as the search
                distance_km, distance_display = pick["distance_km"], pick["distance_display"]

            draft_id = str(uuid.uuid4())
            expires_at = now + self.settings.draft_ttl
            store.insert_draft(conn, draft_id, user_id, station.station_id, req.family_code, now, expires_at)
        return self._draft_view(
            draft_id, "OPEN", station, req.family_code, now, expires_at, None, distance_km, distance_display
        )

    def get_draft(self, user_id: str, draft_id: str) -> dict:
        now = self.clock()
        with self._connect() as conn, conn.transaction():
            row = store.find_draft(conn, user_id, draft_id)
            if row is None:
                raise draft_not_found()
            station_id, family_code, _quantity, created_at, expires_at, reservation_id = row
            station = store.station_in_tx(conn, station_id)
        status = _draft_status(now, expires_at, reservation_id)
        return self._draft_view(draft_id, status, station, family_code, created_at, expires_at, reservation_id)

    def _draft_view(self, draft_id, status, station: Station, family_code, created_at, expires_at,
                    reservation_id, distance_km=None, distance_display=None) -> dict:
        return {
            "draft_id": draft_id,
            "status": status,
            "station": {
                "station_id": station.station_id,
                "name": station.name,
                "area_label": station.area_label,
                "coordinates": {"lat": station.lat, "lng": station.lng},
                "distance_km": distance_km,
                "distance_display": distance_display,
            },
            "family_code": family_code,
            "quantity": 1,
            "available_batteries": station.available_batteries_by_family.get(family_code),
            "hold_minutes": self.settings.hold_minutes,
            "created_at": store.iso(created_at),
            "expires_at": store.iso(expires_at),
            "reservation_id": None if reservation_id is None else str(reservation_id),
        }

    # --- confirmation (§6.7, Reservation_Design §6.2) ---------------------------------

    def confirm(self, user_id: str, req: ConfirmRequest) -> tuple:
        """Return (201, reservation) for a new order or (200, reservation) for a replay.

        The decision time `now` is read only after every lock the request needs has been
        granted (Reservation_Design D-06). Time spent queueing behind another transaction
        can neither keep an expired draft alive (AE-09a) nor shorten the hold (AE-10b).
        """
        request_hash = req.request_hash()
        with self._connect() as conn, conn.transaction():
            # (1) Queue requests sharing (user, operation, key). Only this wait is bounded.
            store.set_lock_timeout(conn, self.settings.idempotency_lock_timeout_ms)
            try:
                store.advisory_lock(conn, user_id, req.idempotency_key)
            except psycopg.errors.LockNotAvailable:
                raise ApiError(
                    409,
                    "REQUEST_IN_PROGRESS",
                    "Yêu cầu cùng khóa đang được xử lý. Vui lòng gửi lại đúng yêu cầu này sau giây lát.",
                    headers={"Retry-After": "1"},
                ) from None
            store.set_lock_timeout(conn, 0)

            # (2) Key already used: replay the original order, before any draft/station check (AE-11).
            previous = store.find_idempotency(conn, user_id, req.idempotency_key)
            if previous is not None:
                stored_hash, reservation_id = previous[0], str(previous[1])
                if stored_hash != request_hash:
                    raise ApiError(
                        409,
                        "IDEMPOTENCY_KEY_REUSED",
                        "Khóa chống xử lý trùng đã được dùng cho một yêu cầu khác.",
                    )
                store.lock_reservation_rows(conn, reservation_id)
                store.expire_if_due(conn, reservation_id, self.clock())  # read after the locks
                return 200, store.reservation_view(conn, reservation_id)

            # (3) The caller's own draft, locked.
            draft = store.lock_draft(conn, user_id, req.draft_id)
            if draft is None:
                raise draft_not_found()
            station_id, family_code, quantity, draft_expires_at = draft
            if store.draft_is_used(conn, req.draft_id):
                raise ApiError(409, "DRAFT_ALREADY_USED", "Bản nháp này đã được dùng để tạo đơn.")
            for field, sent, stored in (
                ("station_id", req.station_id, station_id),
                ("family_code", req.family_code, family_code),
                ("quantity", req.quantity, quantity),
            ):
                if sent != stored:
                    raise ApiError(
                        409,
                        "DRAFT_STALE",
                        "Nội dung xác nhận không khớp bản nháp. Vui lòng tạo bản nháp mới.",
                        [{"field": field, "reason": "CONTENT_MISMATCH",
                          "message": f"{field} khác với bản nháp."}],
                    )

            # (4) Lock the station and its stock rows: the last wait of this transaction.
            store.lock_station_and_stock(conn, station_id)
            now = self.clock()  # decision time, read after every wait (D-06)
            if now >= draft_expires_at:
                raise ApiError(
                    409,
                    "DRAFT_STALE",
                    "Bản nháp đã hết hạn. Vui lòng tạo bản nháp mới.",
                    [{"field": "draft_id", "reason": "DRAFT_EXPIRED", "message": "Bản nháp đã quá hạn xác nhận."}],
                )

            # Re-check the station on the locked rows, same rule order as §4.2 (AE-10, AE-10a).
            eligible, reason = booking_eligibility(store.station_in_tx(conn, station_id), family_code)
            if not eligible:
                raise station_not_eligible(reason)

            # (5) Take exactly one battery, only if one is still there (AE-13).
            if not store.take_one_battery(conn, station_id, family_code):
                raise station_not_eligible("OUT_OF_STOCK")

            # (6) Order and idempotency record in the same transaction; the hold starts at `now`.
            reservation_id = str(uuid.uuid4())
            store.insert_reservation(conn, reservation_id, req.draft_id, now, now + self.settings.hold)
            store.insert_idempotency(conn, user_id, req.idempotency_key, request_hash, reservation_id, now)
            return 201, store.reservation_view(conn, reservation_id)
