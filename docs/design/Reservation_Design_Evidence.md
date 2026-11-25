# Bằng chứng kiểm chứng thiết kế đặt pin (WBS 2.1.3)

Kiểm chứng rằng các giao dịch ở [Reservation_Design.md §6](./Reservation_Design.md#6-giao-dịch-nguyên-tử) chạy đúng trên PostgreSQL thật, kể cả khi nhiều yêu cầu chạy đồng thời, và khớp các ví dụ nghiệm thu mà 2.1.1 bổ sung (AE-09a, AE-10a, AE-10b, AE-11a). Script [db/check_reservation_tx.py](../../db/check_reservation_tx.py) là bản cài tham chiếu tối thiểu của các câu SQL trong thiết kế, **không phải** mã Reservation Service của 2.2. M2/M6 có thể dùng nó làm đối chiếu khi triển khai.

## Cách chạy

```powershell
cd Vinergy
backend\.venv\Scripts\python db/check_reservation_tx.py
```

- Cần `TEST_DATABASE_URL` (biến môi trường hoặc `.env`) trỏ tới CSDL có tên kết thúc bằng `_test`. Script từ chối mọi tên khác.
- Mỗi kịch bản chạy `db/reset.sql` + `db/seed.sql` trước, và đặt lại một lần cuối.
- Thời gian là tham số `now` (D-06), bắt đầu từ `T0 = 2026-11-25T08:00:00Z`, với hạn nháp 5 phút và giữ pin 15 phút (đề xuất của M1 ở SRS §8).
- Điều kiện đặt pin lúc tạo nháp và lúc xác nhận dùng đúng hàm `booking_eligibility` của Station Service trong `backend/app/stations/domain.py` (D-03).
- Tình huống đồng thời: mỗi yêu cầu chạy trên một kết nối riêng, xuất phát cùng lúc bằng `threading.Barrier`. Một bên giữ khóa thêm 0,2–0,3 giây để tranh chấp chắc chắn xảy ra.

## Kết quả

| Môi trường | Ngày | Kết quả |
| --- | --- | --- |
| macOS arm64, Python 3.14.0, psycopg 3.3.9, PostgreSQL 16.16, CSDL biệt lập `vinergy_test` sau migration 002 | 2026-11-25 | **72/72 PASS** |

| Nhóm | Số kiểm tra | Nội dung đã kiểm chứng |
| --- | ---: | --- |
| AE-09, AE-10 | 4 | Bản nháp không đổi tồn kho; xác nhận trừ đúng 1 pin A (6 → 5), pin B và cổng sạc không đổi |
| AE-11, AE-12, AE-14 | 5 | Gửi lại lúc nháp đã hết hạn (T0 + 10 phút) vẫn trả `200` cùng đơn, không trừ thêm; cùng khóa khác body → `IDEMPOTENCY_KEY_REUSED`; khóa theo phạm vi người dùng |
| AE-09a, AE-17 | 5 | Bản nháp đã dùng → `DRAFT_ALREADY_USED`; lệch nội dung → `CONTENT_MISMATCH`; xác nhận **đúng** T0 + 5 phút → `DRAFT_EXPIRED`; yêu cầu bị từ chối không giữ khóa |
| AE-10 (trạm đổi trạng thái) | 2 | Trạm chuyển `MAINTENANCE` trước khi xác nhận → từ chối, tồn kho giữ nguyên |
| AE-11 đồng thời | 4 | Hai yêu cầu cùng khóa, cùng body: một `201`, một `200`, cùng `reservation_id`, một đơn, tồn kho 5 |
| AE-17 đồng thời | 2 | Cùng bản nháp với K1/K2: một `201`, một `DRAFT_ALREADY_USED` |
| AE-13 (3 vòng) | 9 | Viên pin cuối: mỗi vòng đúng một `201`, bên kia `OUT_OF_STOCK`, tồn kho 0, không âm |
| AE-14, AE-15, AE-16a | 6 | Người khác hủy → `RESERVATION_NOT_FOUND`, tồn kho không đổi; hủy hai lần chỉ hoàn một lần (6, không phải 7); worker chạy sau không đổi gì |
| AE-16b | 4 | Hủy đúng lúc E → `EXPIRED`, `expired_at = expires_at`; hủy trước E 1 µs → `CANCELLED` |
| AE-16d (5 vòng) | 5 | Hủy, worker, hủy chạy đồng thời quanh E: tồn kho luôn về 6 đúng một lần |
| Worker (AE-16c) | 4 | Hoàn đúng số đơn của nhiều trạm (ST-01: 6 → 4 → 6, ST-03: 8 → 7 → 8); đơn chưa đến hạn giữ nguyên; chạy lại không hoàn thêm; không tồn kho âm |
| AE-09a, AE-10b | 5 | Nháp tạo T0 hết hạn đúng T0 + 5 phút; xác nhận T0 + 4 phút → giữ đến T0 + 19 phút; lúc T0 + 5 phút nháp hết hạn nhưng đơn vẫn `ACTIVE`, kho 5; chủ đơn đọc đúng T0 + 19 phút → `EXPIRED`, kho 6; người khác đọc → `RESERVATION_NOT_FOUND` |
| AE-10b (đổi cấu hình) | 2 | Giữ pin cấu hình 20 phút: xác nhận T0 + 4 phút → hạn T0 + 24 phút (dịch đúng 5 phút so với cấu hình 15); lúc T0 + 19 đơn vẫn `ACTIVE`, kho 5 |
| AE-10a (lúc tạo nháp) | 5 | ST-02 `CHARGING_ONLY`, ST-04 `UNSUPPORTED_FAMILY`, ST-09 `STATION_CLOSED`, ST-13 `STATION_MAINTENANCE`, ST-05 `OUT_OF_STOCK`; không tạo nháp, tồn kho không đổi |
| AE-10a (lúc xác nhận) | 5 | ST-01 trả đúng lý do khi đóng cửa, bảo trì hoặc hết pin. ST-02 và ST-04 tạm bổ sung một pin A để tạo nháp, sau đó bỏ dòng tồn kho vừa thêm. Xác nhận trả lần lượt `409 STATION_NOT_ELIGIBLE` với `CHARGING_ONLY` và `UNSUPPORTED_FAMILY`. Cả năm ca đều giữ nguyên số đơn và tồn kho so với ngay trước xác nhận. |
| Bảo vệ dòng tồn kho | 2 | Khi còn đơn ACTIVE, DB chặn xóa dòng tồn kho. Sau khi hủy, số pin trở về 6 và có thể xóa dòng kho của nhóm vừa ngừng hỗ trợ. |
| AE-11a | 2 | Hai nháp, hai khóa của USER-A → hai đơn `ACTIVE` khác mã, kho 6 → 4; gửi lại xác nhận thứ hai trả đúng đơn thứ hai, kho vẫn 4 |
| Đặt lại | 1 | `validate_seed.sql` đạt 38/38 sau khi chạy xong |

Chạy độc lập `python db/check_seed.py` trên SQLite đạt các bước kiểm tra fixture, kiểm tra 38 điều kiện seed và ba vòng reset. Khi áp dụng migration 002 lên bản sao đã có đơn ACTIVE, PostgreSQL và SQLite đều giữ dữ liệu lịch sử. Trên PostgreSQL, một giao dịch xóa dòng kho bắt đầu khi xác nhận chưa commit đã chờ rồi bị từ chối. Hủy đơn sau đó hoàn pin về 6. Các kiểm tra nâng cấp và tranh chấp xóa này được chạy riêng ngoài 72 kiểm tra trong script.

## Lịch sử

| Ngày | Kết quả | Thay đổi |
| --- | --- | --- |
| 2026-11-23 | 51/51 | Bản đầu, giá trị tạm 10 phút / 30 phút |
| 2026-11-24 | 68/68 | Theo 2.1.1: 5 phút / 15 phút; thêm AE-09a, AE-10a (10 ca), AE-10b, AE-11a; tạo nháp kiểm tra `booking_eligibility`; `lock_timeout` chỉ áp dụng cho advisory lock; worker dùng `pg_try_advisory_xact_lock`. Ca AE-11 "gửi lại khi nháp hết hạn" dời từ T0 + 20 sang T0 + 10 phút, vì với giữ 15 phút thì lúc T0 + 20 chính đơn cũng đã hết hạn. |
| 2026-11-25 | 70/70 | Theo góp ý review: thêm 2 kiểm tra cho câu cuối AE-10b (đổi thời lượng giữ trong cấu hình thì hạn đơn mới dịch theo). Sửa định dạng 10 sơ đồ Mermaid trong [Reservation_Design.md](./Reservation_Design.md). |
| 2026-11-25 | 72/72 | Áp dụng migration 002, kiểm tra hai thay đổi cấu hình sau khi tạo nháp và vòng đời bảo vệ dòng tồn kho. |

## Giới hạn

- AE-16c chỉ kiểm chứng **câu lệnh** worker. Chu kỳ chạy, độ trễ tối đa và việc khởi động lại tiến trình thuộc 2.2.5, sau khi M2/M6/M7 xác nhận giá trị.
- Phiên demo, CSRF và mã HTTP là phần của lớp API (2.2), chưa có trong script này.
- Kết quả đồng thời phụ thuộc lịch chạy luồng. Các vòng lặp và khoảng giữ khóa làm tranh chấp xảy ra thật, nhưng đây không phải chứng minh hình thức.
