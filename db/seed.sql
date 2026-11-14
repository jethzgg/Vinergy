-- Vinergy — dữ liệu mẫu ban đầu v0.1 (BẢN NHÁP, chờ M4/M7 rà soát)
-- Sinh từ data/seed_stations_v0.json (schema_version 0.1). Nếu sửa JSON thì sinh lại tệp này.
-- DỮ LIỆU MÔ PHỎNG: 18 trạm giả lập khu vực Hà Nội; tên, tọa độ, số lượng không phải địa điểm/thiết bị thật.
-- Chỉ INSERT vào lược đồ trống do db/schema.sql tạo ra. Không xóa/đặt lại dữ liệu (FR-13):
-- chạy lần hai sẽ lỗi trùng khóa chính và giao dịch bị hủy toàn bộ.
-- Trạng thái ban đầu: không có bản nháp, đơn đặt pin hay phiên nào.

BEGIN;

INSERT INTO battery_family (family_code, label, demo_vehicle_id) VALUES
    ('FAM_A', 'Fictional family A', 'VEH_A'),
    ('FAM_B', 'Fictional family B', 'VEH_B');

INSERT INTO app_user (user_id) VALUES
    ('USER-A'),
    ('USER-B');

INSERT INTO demo_origin (origin_id, lat, lng) VALUES
    ('LOC-01', 21.0050, 105.8435),
    ('LOC-02', 21.0285, 105.8542),
    ('LOC-03', 21.2, 105.2);

INSERT INTO station (station_id, name, area_label, lat, lng, opening_status) VALUES
    ('ST-01', 'Vinergy Demo Station 01', 'Hai Ba Trung demo area', 21.0050, 105.8435, 'OPEN'),
    ('ST-02', 'Vinergy Demo Station 02', 'Hai Ba Trung demo area', 20.9958, 105.8675, 'OPEN'),
    ('ST-03', 'Vinergy Demo Station 03', 'Hai Ba Trung demo area', 21.0115, 105.8492, 'OPEN'),
    ('ST-04', 'Vinergy Demo Station 04', 'Dong Da demo area', 21.0118, 105.8335, 'OPEN'),
    ('ST-05', 'Vinergy Demo Station 05', 'Hai Ba Trung demo area', 21.0032, 105.8560, 'OPEN'),
    ('ST-06', 'Vinergy Demo Station 06', 'Dong Da demo area', 21.0075, 105.8278, 'OPEN'),
    ('ST-07', 'Vinergy Demo Station 07', 'Ba Dinh demo area', 21.0185, 105.8152, 'OPEN'),
    ('ST-08', 'Vinergy Demo Station 08', 'Hoan Kiem demo area', 21.0252, 105.8535, 'OPEN'),
    ('ST-09', 'Vinergy Demo Station 09', 'Hoan Kiem demo area', 21.0245, 105.8412, 'CLOSED'),
    ('ST-10', 'Vinergy Demo Station 10', 'Ba Dinh demo area', 21.0318, 105.8125, 'OPEN'),
    ('ST-11', 'Vinergy Demo Station 11', 'Cau Giay demo area', 21.0368, 105.7825, 'OPEN'),
    ('ST-12', 'Vinergy Demo Station 12', 'Cau Giay demo area', 21.0310, 105.7838, 'OPEN'),
    ('ST-13', 'Vinergy Demo Station 13', 'Cau Giay demo area', 21.0082, 105.8015, 'MAINTENANCE'),
    ('ST-14', 'Vinergy Demo Station 14', 'Thanh Xuan demo area', 21.0025, 105.8155, 'OPEN'),
    ('ST-15', 'Vinergy Demo Station 15', 'Thanh Xuan demo area', 20.9885, 105.7950, 'OPEN'),
    ('ST-16', 'Vinergy Demo Station 16', 'Hoang Mai demo area', 20.9795, 105.8415, 'OPEN'),
    ('ST-17', 'Vinergy Demo Station 17', 'Hoang Mai demo area', 20.9665, 105.8285, 'OPEN'),
    ('ST-18', 'Vinergy Demo Station 18', 'Long Bien demo area', 21.0268, 105.8992, 'OPEN');

-- SWAPPING: một dòng cho mỗi (trạm, nhóm được hỗ trợ); 0 = được hỗ trợ nhưng hết pin (ST-05/FAM_A, ST-13).
INSERT INTO station_battery_stock (station_id, family_code, available_batteries) VALUES
    ('ST-01', 'FAM_A', 6),
    ('ST-01', 'FAM_B', 4),
    ('ST-03', 'FAM_A', 8),
    ('ST-04', 'FAM_B', 5),
    ('ST-05', 'FAM_A', 0),
    ('ST-05', 'FAM_B', 3),
    ('ST-06', 'FAM_A', 5),
    ('ST-06', 'FAM_B', 3),
    ('ST-08', 'FAM_A', 7),
    ('ST-08', 'FAM_B', 4),
    ('ST-09', 'FAM_A', 4),
    ('ST-09', 'FAM_B', 2),
    ('ST-10', 'FAM_A', 6),
    ('ST-10', 'FAM_B', 5),
    ('ST-11', 'FAM_A', 9),
    ('ST-11', 'FAM_B', 4),
    ('ST-12', 'FAM_B', 7),
    ('ST-13', 'FAM_A', 0),
    ('ST-13', 'FAM_B', 0),
    ('ST-14', 'FAM_A', 5),
    ('ST-14', 'FAM_B', 5),
    ('ST-15', 'FAM_A', 4),
    ('ST-16', 'FAM_A', 6),
    ('ST-16', 'FAM_B', 6),
    ('ST-18', 'FAM_A', 8),
    ('ST-18', 'FAM_B', 6);

-- CHARGING: chỉ phục vụ tìm kiếm.
INSERT INTO station_charging_port (station_id, family_code, available_ports) VALUES
    ('ST-01', 'FAM_A', 3),
    ('ST-01', 'FAM_B', 2),
    ('ST-02', 'FAM_A', 5),
    ('ST-02', 'FAM_B', 4),
    ('ST-05', 'FAM_A', 2),
    ('ST-05', 'FAM_B', 2),
    ('ST-06', 'FAM_A', 2),
    ('ST-06', 'FAM_B', 1),
    ('ST-07', 'FAM_B', 4),
    ('ST-09', 'FAM_A', 2),
    ('ST-09', 'FAM_B', 2),
    ('ST-10', 'FAM_A', 4),
    ('ST-10', 'FAM_B', 3),
    ('ST-11', 'FAM_A', 3),
    ('ST-11', 'FAM_B', 2),
    ('ST-13', 'FAM_A', 0),
    ('ST-13', 'FAM_B', 0),
    ('ST-14', 'FAM_A', 4),
    ('ST-14', 'FAM_B', 2),
    ('ST-16', 'FAM_A', 3),
    ('ST-16', 'FAM_B', 3),
    ('ST-17', 'FAM_A', 4),
    ('ST-18', 'FAM_A', 5),
    ('ST-18', 'FAM_B', 4);

COMMIT;
