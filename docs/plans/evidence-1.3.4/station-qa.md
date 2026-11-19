# Kết quả QA tìm trạm phục vụ review Sprint 1

Đo ngày 19/11/2026 trên commit `26f66c3420fd01710c66f91fd8260177c658e70f`. Máy Apple M2 Pro, arm64, macOS 27.2.1, Python 3.14.0, SQLite 3.50.4. Ứng dụng nạp seed 18 trạm vào SQLite trong bộ nhớ lúc khởi động.

## NFR-06 — độ trễ phía máy chủ

Đo bằng đồng hồ đơn điệu từ lúc ứng dụng ASGI nhận HTTP request đến lúc tạo xong phần body cuối của response. Các lượt chạy tuần tự, mỗi truy vấn làm nóng 5 lượt trước khi lấy 100 mẫu. Phạm vi đo gồm middleware, kiểm tra đầu vào, truy vấn SQLite và tạo phản hồi. Thời gian nạp ứng dụng, truyền mạng, trình duyệt, Maps và LLM nằm ngoài khoảng đo. Cả hai truy vấn dùng SWAPPING/FAM_A với mặc định chỉ trạm mở.

| Truy vấn | Trạm kỳ vọng | Mẫu đo | Đạt | Lỗi | Timeout | Median (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| LOC-01, bán kính 2 km | 4 | 100 | 100 | 0 | 0 | 0,659 | 1,003 |
| LOC-03, bán kính 0,5 km | 0 | 100 | 100 | 0 | 0 | 0,598 | 0,894 |

Mỗi lượt đạt khi HTTP 200 và số trạm đúng. Cột timeout đếm HTTP 408/504 do ứng dụng trả về. p95 là giá trị thứ 95 sau khi sắp xếp 100 mẫu theo thời lượng tăng dần. Tất cả 210 lượt gồm cả làm nóng có trong [CSV từng lượt](station-latency.csv). Đây là số liệu nền trên một máy cho M2/M7 rà soát ngưỡng.

## Độ bao phủ

Chạy toàn bộ backend và đo riêng app.stations. Có 244 test đạt, 14 test PostgreSQL bỏ qua do thiếu TEST_DATABASE_URL và 21 cảnh báo. Có cảnh báo deprecation và vòng đời kết nối SQLite. Coverage giữ phần PostgreSQL trong mẫu số.

| Mô-đun | Dòng chạy/tổng | Nhánh chạy/tổng | Thiếu |
|---|---:|---:|---|
| domain | 72/72 | 26/26 | — |
| repository | 74/82 | 6/6 | Các dòng 129, 131–136, 138 |
| router | 17/17 | 0/0 | — |
| service | 25/25 | 8/8 | — |
| validation | 139/139 | 46/46 | — |
| __init__ | 0/0 | 0/0 | — |
| **Tổng** | **327/335 (97,61%)** | **86/86 (100%)** | **8 dòng** |

[Báo cáo coverage gốc](coverage-stations.json). M2/M7 còn xác nhận cách áp dụng mục tiêu ≥80%.

## Tái lập

Từ gốc checkout của commit trên, dùng Python đã cài backend/requirements.txt. Đặt EVIDENCE thành đường dẫn tuyệt đối đến thư mục chứa báo cáo này. Các lệnh dưới đây ghi kết quả mới vào /tmp.

```sh
cd backend
PYTHONPATH=. python "$EVIDENCE/measure-station-latency.py" > /tmp/station-latency.csv
python -m pytest -q -rs --cov=app.stations --cov-branch --cov-report=term-missing --cov-report=json:/tmp/coverage-stations.json
```
