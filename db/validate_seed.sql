-- Vinergy — kiểm tra bộ dữ liệu mẫu ban đầu (BẢN NHÁP, chờ M4/M7 rà soát)
--
-- Chỉ đọc. Chạy ngay sau db/seed.sql (hoặc sau db/reset.sql + db/seed.sql).
-- Mỗi dòng kết quả là một phép kiểm tra; mọi dòng phải có result = 'PASS'.
-- Giá trị mong đợi lấy từ data/seed_stations_v0.json (schema_version 0.1);
-- nếu sửa JSON thì phải cập nhật lại các con số ở đây.
--
-- Khung tọa độ ở C3 chỉ là phép kiểm tra hợp lý cho dữ liệu mẫu,
-- không phải ranh giới hành chính và không phải quy tắc lúc chạy (SRS mục 3).

SELECT check_name, expected, actual,
       CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    -- Số lượng bản ghi
    SELECT 'N1 station_count' AS check_name, 18 AS expected, (SELECT COUNT(*) FROM station) AS actual
    UNION ALL SELECT 'N2 battery_family_count', 2, (SELECT COUNT(*) FROM battery_family)
    UNION ALL SELECT 'N3 demo_user_count', 2, (SELECT COUNT(*) FROM app_user)
    UNION ALL SELECT 'N4 demo_origin_count', 3, (SELECT COUNT(*) FROM demo_origin)

    -- Tọa độ
    UNION ALL SELECT 'C1 station_coords_out_of_range', 0,
        (SELECT COUNT(*) FROM station WHERE lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180)
    UNION ALL SELECT 'C2 origin_coords_out_of_range', 0,
        (SELECT COUNT(*) FROM demo_origin WHERE lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180)
    UNION ALL SELECT 'C3 station_outside_hanoi_sample_box', 0,
        (SELECT COUNT(*) FROM station WHERE lat NOT BETWEEN 20.9 AND 21.1 OR lng NOT BETWEEN 105.7 AND 105.95)
    UNION ALL SELECT 'C4 distinct_station_coordinates', 18,
        (SELECT COUNT(*) FROM (SELECT DISTINCT lat, lng FROM station) c)
    UNION ALL SELECT 'C5 st01_equals_loc01', 1,
        (SELECT COUNT(*) FROM station s JOIN demo_origin o ON o.lat = s.lat AND o.lng = s.lng
          WHERE s.station_id = 'ST-01' AND o.origin_id = 'LOC-01')

    -- Trạng thái và dịch vụ
    UNION ALL SELECT 'S1 open_stations', 16, (SELECT COUNT(*) FROM station WHERE opening_status = 'OPEN')
    UNION ALL SELECT 'S2 closed_is_st09_only', 1,
        (SELECT COUNT(*) FROM station WHERE opening_status = 'CLOSED' AND station_id = 'ST-09')
    UNION ALL SELECT 'S3 maintenance_is_st13_only', 1,
        (SELECT COUNT(*) FROM station WHERE opening_status = 'MAINTENANCE' AND station_id = 'ST-13')
    UNION ALL SELECT 'S4 stations_without_any_service', 0,
        (SELECT COUNT(*) FROM station s
          WHERE NOT EXISTS (SELECT 1 FROM v_station_resource r WHERE r.station_id = s.station_id))
    UNION ALL SELECT 'S5 swapping_stations', 15, (SELECT COUNT(DISTINCT station_id) FROM station_battery_stock)
    UNION ALL SELECT 'S6 charging_stations', 13, (SELECT COUNT(DISTINCT station_id) FROM station_charging_port)
    UNION ALL SELECT 'S7 charging_only_are_st02_st07_st17', 3,
        (SELECT COUNT(DISTINCT p.station_id) FROM station_charging_port p
          WHERE p.station_id IN ('ST-02', 'ST-07', 'ST-17')
            AND NOT EXISTS (SELECT 1 FROM station_battery_stock b WHERE b.station_id = p.station_id))
    UNION ALL SELECT 'S8 charging_only_total', 3,
        (SELECT COUNT(DISTINCT p.station_id) FROM station_charging_port p
          WHERE NOT EXISTS (SELECT 1 FROM station_battery_stock b WHERE b.station_id = p.station_id))
    UNION ALL SELECT 'S9 swapping_only_total', 5,
        (SELECT COUNT(DISTINCT b.station_id) FROM station_battery_stock b
          WHERE NOT EXISTS (SELECT 1 FROM station_charging_port p WHERE p.station_id = b.station_id))

    -- Khả năng tương thích
    UNION ALL SELECT 'F1 swap_only_fam_a_at_st03_st15', 2,
        (SELECT COUNT(*) FROM station_battery_stock b
          WHERE b.station_id IN ('ST-03', 'ST-15') AND b.family_code = 'FAM_A'
            AND NOT EXISTS (SELECT 1 FROM v_station_resource r
                             WHERE r.station_id = b.station_id AND r.family_code = 'FAM_B'))
    UNION ALL SELECT 'F2 swap_only_fam_b_at_st04_st12', 2,
        (SELECT COUNT(*) FROM station_battery_stock b
          WHERE b.station_id IN ('ST-04', 'ST-12') AND b.family_code = 'FAM_B'
            AND NOT EXISTS (SELECT 1 FROM v_station_resource r
                             WHERE r.station_id = b.station_id AND r.family_code = 'FAM_A'))
    -- JSON khai báo supported_families chung cho cả trạm: trạm có cả hai dịch vụ
    -- phải hỗ trợ cùng một tập nhóm ở cả hai dịch vụ.
    UNION ALL SELECT 'F3 family_mismatch_between_services', 0,
        (SELECT COUNT(*) FROM v_station_resource r
          WHERE EXISTS (SELECT 1 FROM v_station_resource o
                         WHERE o.station_id = r.station_id AND o.service_type <> r.service_type)
            AND NOT EXISTS (SELECT 1 FROM v_station_resource o
                             WHERE o.station_id = r.station_id AND o.service_type <> r.service_type
                               AND o.family_code = r.family_code))
    UNION ALL SELECT 'F4 swap_support_rows_fam_a', 13,
        (SELECT COUNT(*) FROM station_battery_stock WHERE family_code = 'FAM_A')
    UNION ALL SELECT 'F5 swap_support_rows_fam_b', 13,
        (SELECT COUNT(*) FROM station_battery_stock WHERE family_code = 'FAM_B')

    -- Tồn kho
    UNION ALL SELECT 'K1 battery_stock_rows', 26, (SELECT COUNT(*) FROM station_battery_stock)
    UNION ALL SELECT 'K2 charging_port_rows', 24, (SELECT COUNT(*) FROM station_charging_port)
    UNION ALL SELECT 'K3 negative_counts', 0,
        (SELECT COUNT(*) FROM v_station_resource WHERE available_count < 0)
    UNION ALL SELECT 'K4 total_batteries_fam_a', 68,
        (SELECT SUM(available_batteries) FROM station_battery_stock WHERE family_code = 'FAM_A')
    UNION ALL SELECT 'K5 total_batteries_fam_b', 54,
        (SELECT SUM(available_batteries) FROM station_battery_stock WHERE family_code = 'FAM_B')
    UNION ALL SELECT 'K6 total_charging_ports', 66, (SELECT SUM(available_ports) FROM station_charging_port)
    UNION ALL SELECT 'K7 st01_fam_a_batteries', 6,
        (SELECT available_batteries FROM station_battery_stock WHERE station_id = 'ST-01' AND family_code = 'FAM_A')
    UNION ALL SELECT 'K8 st05_fam_a_supported_but_empty', 0,
        (SELECT available_batteries FROM station_battery_stock WHERE station_id = 'ST-05' AND family_code = 'FAM_A')
    UNION ALL SELECT 'K9 st09_closed_with_positive_counts', 4,
        (SELECT COUNT(*) FROM v_station_resource WHERE station_id = 'ST-09' AND available_count > 0)
    UNION ALL SELECT 'K10 st13_maintenance_all_zero', 4,
        (SELECT COUNT(*) FROM v_station_resource WHERE station_id = 'ST-13' AND available_count = 0)
    UNION ALL SELECT 'K11 st02_fam_a_charging_ports', 5,
        (SELECT available_ports FROM station_charging_port WHERE station_id = 'ST-02' AND family_code = 'FAM_A')

    -- Trạng thái ban đầu rỗng
    UNION ALL SELECT 'E1 initial_drafts', 0, (SELECT COUNT(*) FROM reservation_draft)
    UNION ALL SELECT 'E2 initial_reservations', 0, (SELECT COUNT(*) FROM reservation)
    UNION ALL SELECT 'E3 initial_idempotency_records', 0, (SELECT COUNT(*) FROM idempotency_record)
    UNION ALL SELECT 'E4 initial_sessions', 0, (SELECT COUNT(*) FROM user_session)
) checks
ORDER BY check_name;
