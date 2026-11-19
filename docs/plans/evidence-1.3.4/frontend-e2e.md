# Bằng chứng giao diện và AE-05 — 19/11/2026

Phiên bản ứng dụng 26f66c3420fd01710c66f91fd8260177c658e70f. Checkout thử nghiệm riêng có bổ sung một ca Playwright. Node v24.12.0, Playwright 1.65.1, Google Chrome 157.0.8103.79, một worker. FastAPI sử dụng SQLite seed và giao diện dùng SDK bản đồ giả lập. Máy chạy dùng cổng backend 18013 để không ảnh hưởng demo đang chạy ở 8013. Frontend dùng cổng 5183 theo cấu hình gốc.

| Ca | Kết quả trực tiếp |
|---|---|
| AE-05 timeout chạy riêng | 1/1 đạt trong 2,0 giây. Giữ một HTTP request sau khi có bốn trạm. Khi UI đang tải, tiến đồng hồ trình duyệt 15.001 ms. UI báo “Hết thời gian chờ dịch vụ trạm.”, thoát tải, xóa thẻ và điểm bản đồ cũ, không hiện tiêu đề kết quả rỗng. Thử lại đi qua API seed, trả 200 và khôi phục đủ ST-01, ST-03, ST-05, ST-06 theo thứ tự ở cả hai nơi. |
| Toàn bộ suite | 14/14 đạt trong 8,2 giây, gồm 13 ca tại SHA trên và ca AE-05 mới. |
| AE-01 trong suite | Thứ tự bốn trạm đúng ở danh sách và bản đồ. ST-05 hiển thị tồn kho A bằng 0, nút đặt pin bị vô hiệu. Nút chỉ đường mở tab có đích 21.0032,105.856. Chọn điểm ST-03 trên bản đồ mở đúng chi tiết ST-03. |
| AE-05 kết quả rỗng trong suite | LOC-03, bán kính 0,5 km hiển thị tiêu đề kết quả rỗng, xóa thẻ và điểm cũ. Ca lỗi mạng riêng hiển thị trạng thái lỗi có thử lại. |

## Chạy lại

Dùng một checkout sạch tại SHA trên, với môi trường Python đã cài backend/requirements.txt trên PATH và frontend đã chạy npm ci. Chuẩn bị Chrome cho PLAYWRIGHT_CHANNEL=chrome. Ở gốc checkout riêng, nối [đoạn kiểm thử](./ae05-timeout.test-fragment.js) **một lần** vào cuối bộ test để sử dụng chung fixture, SDK giả lập và selector của suite. Thay EVIDENCE bằng thư mục chứa tệp bằng chứng. Cấu hình gốc cần backend 8013 và frontend 5183 còn trống.

```sh
cat "$EVIDENCE/ae05-timeout.test-fragment.js" >> frontend/tests/stations.spec.js
cd frontend
PLAYWRIGHT_CHANNEL=chrome npm test -- --grep 'AE-05 search timeout' --reporter=line
PLAYWRIGHT_CHANNEL=chrome npm test -- --reporter=line
```

Bộ test xác minh điểm đích của liên kết chỉ đường ở tab mới. Google Maps được chặn bằng route giả và không tính lộ trình thật. Ca timeout thêm vào checkout kiểm thử cục bộ, chưa được tích hợp vào suite trên main.
