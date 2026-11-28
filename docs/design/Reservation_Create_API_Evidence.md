# Bằng chứng WBS 2.2.1: API tạo đơn và giữ pin nguyên tử

> **Phụ trách:** M4 (Bui Quang Minh) | **Hợp đồng:** [api_contracts.md §6.1–§6.7, §6.11](../architecture/api_contracts.md#6-đặt-pin-sprint-2) | **Thiết kế:** [Reservation_Design.md §4, §6.1–§6.3](./Reservation_Design.md)

## Phạm vi

| Endpoint | Việc làm |
| --- | --- |
| `POST /api/v1/reservation-drafts` | Tạo bản nháp theo `station_id` hoặc `nearest`. Chỉ trạm đổi pin đang mở, hỗ trợ nhóm pin và còn pin mới nhận nháp. Không đổi tồn kho. |
| `GET /api/v1/reservation-drafts/{draft_id}` | Đọc lại bản nháp của chính mình, `status` và tồn kho tính lại lúc đọc |
| `POST /api/v1/reservations` | Xác nhận trong một giao dịch PostgreSQL: khóa idempotency, khóa bản nháp, đánh giá lại trạm trên dòng đã khóa, trừ đúng 1 pin bằng `UPDATE … WHERE available_batteries >= 1`, ghi đơn và khóa chống trùng cùng lúc |

Không thuộc 2.2.1:
- **Tạo/hủy phiên** (`/api/v1/demo-session`) và test phân quyền đầy đủ thuộc 2.2.3 (M2). 2.2.1 chỉ có phần đọc phiên và kiểm tra CSRF ở [backend/app/demo_session.py](../../backend/app/demo_session.py). M2 bổ sung endpoint vào cùng module và dùng chung `session_token_hash`, `csrf_token_for`.
- **Danh sách, chi tiết, hủy đơn và worker hết hạn** thuộc 2.2.5 (M6). Khi gửi lại sau mất phản hồi, đơn đã quá hạn được đối soát bằng `store.expire_if_due`. M6 có thể thay hàm này bằng routine hoàn pin dùng chung.
- Chức năng đặt pin cần `DATABASE_URL` trỏ tới PostgreSQL. Khi không có, các endpoint trả `500 INTERNAL_ERROR`; tìm trạm vẫn dùng SQLite như trước.

## Mã nguồn

| File | Nội dung |
| --- | --- |
| `backend/app/reservations/router.py` | Thứ tự kiểm tra §1.3: phiên → `Content-Type` → CSRF → validate → nghiệp vụ |
| `backend/app/reservations/validation.py` | Validate JSON chặt chẽ theo §6.2 (gom mọi lỗi, không ép kiểu), `request_hash` |
| `backend/app/reservations/service.py` | Tạo nháp, đọc nháp, giao dịch xác nhận theo Reservation_Design §6.2 |
| `backend/app/reservations/store.py` | Câu SQL, thứ tự khóa cố định: advisory → bản nháp → trạm → tồn kho → chèn |
| `backend/app/reservations/config.py` | `DRAFT_TTL_MINUTES=5`, `RESERVATION_HOLD_MINUTES=15`, `IDEMPOTENCY_LOCK_TIMEOUT_MS=5000` |

## Kiểm thử

```powershell
cd backend
.venv\Scripts\python -m pytest -q
```

`test_reservations_postgres.py` cần `TEST_DATABASE_URL` trỏ tới CSDL có tên kết thúc bằng `_test`. Mỗi test chạy `reset.sql` + `seed.sql`. Nếu CSDL mới chỉ có migration 001, test tự áp dụng 002. CI có dịch vụ PostgreSQL 18 nên các test này chạy cả trên GitHub Actions.

| Nhóm | Số test | Nội dung |
| --- | ---: | --- |
| Validate (không cần DB) | 85 | AE-08 với 10 giá trị `quantity`, kể cả số nguyên quá lớn (10^400) trả 400 chứ không 500; `nearest.radius_km = null` bị từ chối (`NOT_A_NUMBER`), chỉ bỏ hẳn trường mới là không giới hạn; mọi tham số query là `UNKNOWN_PARAM`, xếp sau lỗi path/body; đúng một trong `station_id`/`nearest`; `user_id`/`owner`/`demo_user`/`origin` bị từ chối là `UNKNOWN_FIELD`; payload cũ có `draft_revision` bị từ chối; `Idempotency-Key`; UUID; `request_hash` không phụ thuộc thứ tự khóa; token phiên/CSRF; cấu hình; `SESSION_SECRET` rỗng hoặc là giá trị mẫu thì dịch vụ đặt pin và ứng dụng từ chối khởi động |
| Phiên và thứ tự kiểm tra | 4 | 401 trước 415 trước 403 trước 400; phiên bị thu hồi; hết hạn đúng mốc `expires_at` (AE-23f); CSRF của phiên khác |
| Bản nháp | 10 | AE-09 không đổi tồn kho; AE-18 chọn ST-03 cách 1.1619… km và không nới bán kính; AE-03/AE-10a năm lý do; trạm không tồn tại; đọc lại, quyền sở hữu, `USED`/`EXPIRED` |
| Xác nhận | 7 | AE-10 trừ đúng 1 pin A (6 → 5), pin B và cổng sạc không đổi; AE-10b hạn 08:19 và đổi cấu hình 20 phút; AE-09a đúng mốc hết hạn bị từ chối, không lưu gì; `CONTENT_MISMATCH`; AE-17; AE-14 |
| AE-10a lúc xác nhận | 6 | Đóng cửa, bảo trì, hết pin, **chỉ sạc**, **bỏ FAM_A** sau khi tạo nháp: đúng lý do, tồn kho/đơn/khóa thay đổi 0. Đơn `ACTIVE` chặn xóa dòng tồn kho của nó (migration 002) |
| Gửi lại và idempotency | 6 | AE-11 trả cùng đơn, kể cả khi nháp đã hết hạn; quá hạn giữ thì trả `EXPIRED` và hoàn pin đúng một lần; AE-12; khóa theo từng người; AE-11a; `REQUEST_IN_PROGRESS` + `Retry-After: 1`; lỗi giữa chừng sau khi trừ kho thì rollback toàn bộ |
| Sửa theo review 28/11 | 12 | Xem mục bên dưới |
| Đồng thời | 6 | AE-13 viên pin cuối (3 vòng): đúng một `201`, bên kia `OUT_OF_STOCK`, kho 0; 6 người tranh 2 pin: đúng 2 đơn, kho 0; cùng khóa gửi đồng thời: một `201`, một `200`, một đơn; cùng nháp hai khóa: một `201`, một `DRAFT_ALREADY_USED` |

### Sửa theo review ngày 28/11/2026

| # | Lỗi được báo | Cách sửa | Test chứng minh |
| --- | --- | --- | --- |
| P1 | Đồng hồ được đọc trước khi chờ khóa. Yêu cầu đến 08:04:59, chờ khóa tồn kho qua 08:05:00 vẫn được `201` và trừ kho. | `now` đọc **sau** lần chờ khóa cuối (D-06 v2.3); kiểm tra `DRAFT_EXPIRED` chuyển xuống sau bước khóa tồn kho; hạn giữ tính từ mốc đó. Nhánh gửi lại cũng khóa trước rồi mới đọc `now`. | Giữ khóa thật bằng một giao dịch khác rồi dịch đồng hồ khi yêu cầu đang chờ (chờ đến khi `pg_stat_activity` báo `Lock`): hết hạn lúc chờ → `DRAFT_STALE`/`DRAFT_EXPIRED`, kho 6, 0 đơn; chờ 08:01 → 08:03 → đơn tạo 08:03, hạn 08:18; gửi lại chờ qua hạn giữ → `EXPIRED`, hoàn pin đúng một lần |
| P2 | `nearest` chọn trạm từ lần đọc này nhưng dựng phản hồi từ lần đọc khác, nên có thể trả nháp `OPEN` với `available_batteries = 0`. | Tìm, chọn, dựng phản hồi và ghi nháp trong một giao dịch `REPEATABLE READ`; thử lại tối đa 3 lần khi gặp `serialization_failure`. | Đơn khác lấy viên pin cuối ở ST-03 ngay sau lần tìm: nháp vẫn khớp dữ liệu đã chọn (`OPEN`, 1 pin), xác nhận sau đó trả `OUT_OF_STOCK`; ST-03 hết pin từ trước thì chọn ST-01 (1.3129 km) |
| P2 | `?owner=USER-B` vẫn tạo nháp và đơn. | Cả ba endpoint từ chối mọi tham số query bằng `400 UNKNOWN_PARAM` ở bước validate (§1.3 bước 6). | `owner`, `user_id`, `demo_user` trên cả ba endpoint: 400, không ghi gì, khóa idempotency vẫn dùng được; 401/403 vẫn trả trước |
| P2 | `radius_km = null` bị coi như không gửi. | Kiểm tra sự **có mặt** của trường trước giá trị. | `null`, `0`, `-1`, `"5"`, `true`, 10^400 |
| P2 | Số nguyên JSON quá lớn làm `math.isfinite()` ném `OverflowError` (500). | Số nguyên luôn là số hợp lệ; tọa độ/bán kính đổi sang `float` an toàn, không biểu diễn được thì `NOT_A_NUMBER`. | `quantity` → `MUST_BE_ONE`; `nearest.lat/lng` → `NOT_A_NUMBER`; cả body JSON thô |
| P2 | 404 khi đọc nháp người khác thiếu `Cache-Control: no-store`. | `NoStoreRoute` gắn `no-store` cho mọi phản hồi của router đặt pin: thành công, `ApiError` và lỗi 500 bất ngờ. | 9 phản hồi 200/201/400/401/403/404/409/415 và một lỗi 500 giả lập |
| P2 | Dịch vụ đặt pin chấp nhận `SESSION_SECRET` rỗng hoặc giá trị mẫu. | `ReservationService` gọi `demo_session.require_usable_secret`; có `DATABASE_URL` mà khóa chưa riêng thì ứng dụng dừng ngay lúc khởi động với `SessionSecretError` (không in giá trị khóa). | Rỗng, toàn khoảng trắng, giá trị mẫu; `main._reservation_service()` |

`tests/conftest.py` đặt `DATABASE_URL` rỗng trước khi import ứng dụng, nên bộ test không bao giờ dùng CSDL dev hay `SESSION_SECRET` trong `.env` của máy chạy.

### Kết quả ngày 28/11/2026 (sau khi sửa theo review)

| Kiểm tra | Kết quả |
| --- | --- |
| `pytest` toàn bộ backend | **394 passed** (353 + 29 validate + 12 PostgreSQL mới) |
| Làm hỏng có chủ đích: đặt lại `service.py` trước review | 4 test mới **trượt** (test AE-09a nhận `201`, đúng như review mô tả) |
| Làm hỏng có chủ đích: bỏ `NoStoreRoute`, bỏ kiểm tra query, dùng lại `.get("radius_km")` và `math.isfinite` trên số nguyên | 13 test mới **trượt**; khôi phục thì toàn bộ đạt |
| Chạy thật bằng uvicorn: 7 kiểm tra cũ + `?owner`, `radius_km = null`, `lat = 10^400`, `no-store` trên 401, khởi động với khóa mẫu | 12/12 đạt |
| `db/check_seed.py`, `db/check_reservation_tx.py` | ĐẠT |

### Kết quả ngày 27/11/2026

| Kiểm tra | Kết quả |
| --- | --- |
| `pytest` toàn bộ backend (Windows 11, Python 3.10.11, PostgreSQL 18, `vinergy_test`) | **353 passed** (258 cũ + 56 + 39 mới) |
| Làm hỏng có chủ đích: bỏ điều kiện `available_batteries >= 1` và bỏ khóa dòng tồn kho | 4 test tranh chấp **trượt**, khôi phục thì đạt lại. Các test này bắt được lỗi bán quá viên pin cuối. |
| Chạy thật bằng uvicorn trên `vinergy_test`: thiếu phiên, tạo nháp, xác nhận, CORS, gửi lại, `quantity = 2`, đọc lại nháp | 7/7 đạt |
| `db/check_seed.py`, `db/check_reservation_tx.py` | ĐẠT |
