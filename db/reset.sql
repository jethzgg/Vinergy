-- Vinergy — xóa toàn bộ dữ liệu để nạp lại bộ dữ liệu mẫu (BẢN NHÁP, chờ M4/M7 rà soát)
--
-- !!! CÓ XÓA DỮ LIỆU. CHỈ chạy trên cơ sở dữ liệu phát triển/kiểm thử biệt lập (FR-13).
-- !!! Không chạy trên dữ liệu dùng chung hoặc dữ liệu thật; không gọi từ giao diện người dùng.
--
-- Đặt lại lặp lại được = chạy tệp này rồi chạy db/seed.sql:
--     psql -d <db_thử_nghiệm> -f db/reset.sql -f db/seed.sql
-- Chạy bao nhiêu lần cũng cho cùng trạng thái ban đầu: 18 trạm, số lượng gốc,
-- không có bản nháp/đơn/bản ghi chống lặp/phiên.
--
-- Tệp này CHƯA có cơ chế tự kiểm tra môi trường và xác nhận theo AE-22;
-- phần bảo vệ đó thuộc công cụ đặt lại của EN-104 (WBS 3.2.3).
--
-- Thứ tự xóa đi từ bảng con tới bảng cha để không vi phạm khóa ngoại.

BEGIN;

DELETE FROM idempotency_record;
DELETE FROM reservation;
DELETE FROM reservation_draft;
DELETE FROM user_session;
DELETE FROM station_charging_port;
DELETE FROM station_battery_stock;
DELETE FROM station;
DELETE FROM demo_origin;
DELETE FROM app_user;
DELETE FROM battery_family;

COMMIT;
