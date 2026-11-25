

## 1. Yêu cầu dữ liệu

### 1.1 Dữ liệu cần lưu

| # | Yêu cầu dữ liệu | Nguồn |
| --- | --- | --- |
| R1 | Đúng hai nhóm xe/pin giả lập `FAM_A`/`FAM_B`, mỗi nhóm có nhãn và một mã xe demo | BR-01 |
| R2 | 18 trạm giả lập: mã, tên, nhãn khu vực, tọa độ, trạng thái `OPEN`/`CLOSED`/`MAINTENANCE` | FR-04, mục 6 SRS |
| R3 | Mỗi trạm cung cấp `CHARGING` và/hoặc `SWAPPING`; không có giá trị `BOTH` | BR-02 |
| R4 | Với từng dịch vụ, trạm hỗ trợ một hoặc cả hai nhóm; mỗi cặp (trạm, nhóm) có số lượng nguyên không âm: số pin khả dụng (đổi pin) hoặc số cổng sạc (sạc) | BR-03, mục 6 SRS |
| R5 | Phân biệt được “không hỗ trợ” với “hỗ trợ nhưng số lượng bằng không” | BR-03, AE-02 |
| R6 | Người dùng demo (`USER-A`, `USER-B`); danh tính lấy từ phiên phía máy chủ | BR-10, AE-14 |
| R7 | Bản nháp đặt pin: gắn với người dùng, trạm, nhóm, `quantity = 1`, có thời hạn; không giữ tồn kho | BR-05, BR-06 |
| R8 | Đơn đặt pin: mã đơn, trạng thái `ACTIVE`/`CANCELLED`/`EXPIRED`, thời điểm tạo/hết hạn/hủy do máy chủ ghi | BR-09 |
| R9 | Mỗi bản nháp tạo tối đa một đơn, kể cả khi xác nhận đồng thời | BR-06, AE-17 |
| R10 | Bản ghi chống xử lý lặp theo phạm vi (người dùng, thao tác, khóa), kèm dấu vết nội dung yêu cầu và đơn kết quả | BR-08, AE-11, AE-12 |
| R11 | Ba vị trí mẫu `LOC-01`…`LOC-03` cho nhập thủ công và kiểm thử | AE-01, AE-04, AE-05 |

### 1.2 Thao tác chính mà lược đồ phải phục vụ

| Thao tác | Dữ liệu chạm tới | Ghi chú |
| --- | --- | --- |
| Tìm trạm theo dịch vụ/nhóm/trạng thái (UC-01) | Trạm + tài nguyên của dịch vụ được chọn | Chỉ đọc. Khoảng cách Haversine tính ở tầng ứng dụng trên giá trị chưa làm tròn, không lưu trong CSDL (BR-04) |
| Tạo bản nháp (UC-02 bước 2) | Thêm một bản nháp | Không đổi tồn kho |
| Xác nhận (UC-02 bước 5–6) | Bản ghi chống lặp, bản nháp, trạm, tồn kho pin, đơn | Một giao dịch nguyên tử (BR-07) |
| Xem/hủy đơn của mình (UC-03) | Đơn, bản nháp (chủ sở hữu), tồn kho pin | Đối soát hết hạn trước khi trả kết quả (BR-09) |
| Tác vụ nền xử lý hết hạn | Đơn `ACTIVE` quá hạn, tồn kho pin | Cần chỉ mục theo `expires_at` |

### 1.3 Ràng buộc toàn vẹn rút ra từ quy tắc nghiệp vụ

- Số lượng tài nguyên không bao giờ âm (NFR-01, AE-13).
- Chỉ đặt pin tại cặp (trạm, nhóm) có hỗ trợ đổi pin; đặt pin không bao giờ đổi số cổng sạc (BR-02, AE-03).
- `quantity` đúng bằng 1 (BR-05).
- Đơn `CANCELLED` phải có thời điểm hủy **trước** hạn; đơn `EXPIRED` chỉ từ thời điểm hết hạn trở đi (BR-09, AE-16).
- Chỉ lần chuyển thành công từ `ACTIVE` mới hoàn pin, đúng một lần (BR-09, AE-15).

## 2. Mô hình ER (mức khái niệm)

### 2.1 Thực thể và thuộc tính

Khóa chính được **in đậm**. Thuộc tính suy diễn không lưu trữ được ghi rõ.

| Thực thể | Loại | Thuộc tính |
| --- | --- | --- |
| **BATTERY_FAMILY** (nhóm xe/pin) | Mạnh | **family_code**, label, demo_vehicle_id (duy nhất) |
| **STATION** (trạm) | Mạnh | **station_id**, name, area_label, tọa độ (thuộc tính phức hợp: lat, lng), opening_status. Suy diễn: `services`, `supported_families` |
| **APP_USER** (người dùng demo) | Mạnh | **user_id**, created_at |
| **USER_SESSION** (phiên) — *tạm thời* | Mạnh | **session_token_hash**, created_at, expires_at, revoked_at |
| **RESERVATION_DRAFT** (bản nháp) | Mạnh | **draft_id**, quantity, created_at, expires_at. Suy diễn: “đã dùng” = có đơn liên kết; “hết hạn” = so `expires_at` với giờ máy chủ |
| **RESERVATION** (đơn đặt pin) | Mạnh | **reservation_id**, status, created_at, expires_at, cancelled_at, expired_at |
| **IDEMPOTENCY_RECORD** (bản ghi chống lặp) | Yếu, phụ thuộc APP_USER | Khóa bộ phận: (operation, idempotency_key); request_hash, created_at |
| **DEMO_ORIGIN** (vị trí mẫu) | Mạnh, đứng độc lập | **origin_id**, lat, lng |

`CHARGING`/`SWAPPING` không phải thực thể: mỗi dịch vụ được thể hiện bằng một mối quan hệ riêng giữa STATION và BATTERY_FAMILY (xem R1, R2 dưới đây), vì hai dịch vụ có hành vi khác nhau — tồn kho pin bị giao dịch thay đổi, còn cổng sạc chỉ để tìm kiếm.

### 2.2 Mối quan hệ

| # | Mối quan hệ | Giữa | Bản số | Tham gia | Thuộc tính của quan hệ |
| --- | --- | --- | --- | --- | --- |
| R1 | **STOCKS_BATTERY** (hỗ trợ đổi pin) | STATION — BATTERY_FAMILY | M : N | Cả hai phía tùy chọn (trạm chỉ sạc không tham gia) | available_batteries ≥ 0 |
| R2 | **OFFERS_CHARGING** (hỗ trợ sạc) | STATION — BATTERY_FAMILY | M : N | Cả hai phía tùy chọn | available_ports ≥ 0 |
| R3 | **HAS_SESSION** | APP_USER — USER_SESSION | 1 : N | Phiên bắt buộc có người dùng; người dùng có 0..N phiên | — |
| R4 | **PREPARES** (chuẩn bị) | APP_USER — RESERVATION_DRAFT | 1 : N | Bản nháp bắt buộc có đúng một người dùng; người dùng có 0..N bản nháp | — |
| R5 | **TARGETS** (nhắm tới) | RESERVATION_DRAFT — STATION và RESERVATION_DRAFT — BATTERY_FAMILY | N : 1 cho từng quan hệ | Bản nháp tham chiếu trạm và nhóm đã chọn; máy chủ kiểm tra hỗ trợ đổi pin ở lúc tạo và lúc xác nhận | AE-10a |
| R6 | **CONFIRMED_AS** (được xác nhận thành) | RESERVATION_DRAFT — RESERVATION | 1 : 1 | Đơn bắt buộc có đúng một bản nháp; bản nháp có 0..1 đơn | — |
| R7 | **OWNS_KEY** (quan hệ định danh) | APP_USER — IDEMPOTENCY_RECORD | 1 : N | Bản ghi bắt buộc có người dùng | — |
| R8 | **RESULTED_IN** (cho kết quả) | IDEMPOTENCY_RECORD — RESERVATION | 1 : 1 | Bản ghi bắt buộc trỏ tới đúng một đơn; mỗi đơn có đúng một bản ghi thao tác xác nhận | — |

Ghi chú khi vẽ:

- R5 gồm hai liên kết riêng để bản nháp còn truy xuất được sau khi trạm thay đổi nhóm hỗ trợ. ERD Sprint 2 phản ánh quan hệ này trong [thiết kế đặt pin §5.2](./Reservation_Design.md#52-sơ-đồ-er-v2-phần-đặt-pin).
- RESERVATION **không** có quan hệ trực tiếp với APP_USER, STATION hay BATTERY_FAMILY: chủ sở hữu, trạm và nhóm của đơn được xác định qua bản nháp (R6 → R4, R5).
- Vòng đời `ACTIVE → CANCELLED | EXPIRED` là thuộc tính `status` của RESERVATION, không phải thực thể riêng.
- DEMO_ORIGIN không có mối quan hệ nào.

ER diagram: https://app.diagrams.net/#G147Q8nPlmETRmFq8c0bAgnnfp3QQhCmQd#%7B%22pageId%22%3A%22aG4sCEwbdC_HGeR1unjR%22%7D 
## 3. Lược đồ quan hệ

### 3.1 Quy tắc ánh xạ đã áp dụng

| Thành phần ER | Cách ánh xạ |
| --- | --- |
| Thực thể mạnh | Một quan hệ; thuộc tính phức hợp tọa độ tách thành `lat`, `lng` |
| R1, R2 (M:N có thuộc tính) | Quan hệ riêng, khóa chính là cặp khóa ngoại (station_id, family_code) |
| R3, R4, R5 (1:N) | Khóa ngoại đặt ở phía N; R5 dùng khóa ngoại riêng tới trạm và nhóm |
| R6 (1:1, một phía bắt buộc) | Khóa ngoại `draft_id` + `UNIQUE` đặt ở RESERVATION (phía tham gia bắt buộc) để không có giá trị NULL |
| Thực thể yếu IDEMPOTENCY_RECORD | Khóa chính = khóa của chủ (`user_id`) + khóa bộ phận |
| R8 (1:1) | Khóa ngoại `reservation_id` ở IDEMPOTENCY_RECORD + `UNIQUE (operation, reservation_id)` |
| Thuộc tính suy diễn | Không lưu; cung cấp qua khung nhìn |

### 3.2 Các quan hệ

Dòng dưới mỗi quan hệ ghi khóa chính (PK), ràng buộc duy nhất (UNIQUE) và khóa ngoại (FK, quan hệ đích sau mũi tên).

```
battery_family        (family_code, label, demo_vehicle_id)
                      PK family_code · UNIQUE demo_vehicle_id

station               (station_id, name, area_label, lat, lng, opening_status)
                      PK station_id

station_battery_stock (station_id, family_code, available_batteries)
                      PK (station_id, family_code)
                      FK station_id → station · FK family_code → battery_family

station_charging_port (station_id, family_code, available_ports)
                      PK (station_id, family_code)
                      FK station_id → station · FK family_code → battery_family

app_user              (user_id, created_at)
                      PK user_id

user_session          (session_token_hash, user_id, created_at, expires_at, revoked_at)
                      PK session_token_hash · FK user_id → app_user

reservation_draft     (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)
                      PK draft_id · FK user_id → app_user
                      FK station_id → station · FK family_code → battery_family

reservation           (reservation_id, draft_id, status, created_at, expires_at, cancelled_at, expired_at)
                      PK reservation_id · UNIQUE draft_id · FK draft_id → reservation_draft

idempotency_record    (user_id, operation, idempotency_key, request_hash, reservation_id, created_at)
                      PK (user_id, operation, idempotency_key)
                      UNIQUE (operation, reservation_id)
                      FK user_id → app_user · FK reservation_id → reservation

demo_origin           (origin_id, lat, lng)
                      PK origin_id
```

### 3.3 Miền giá trị và ràng buộc

| Quan hệ | Ràng buộc | Quy tắc |
| --- | --- | --- |
| battery_family | `family_code IN ('FAM_A','FAM_B')` | BR-01 |
| station | `opening_status IN ('OPEN','CLOSED','MAINTENANCE')`; lat ∈ [−90, 90]; lng ∈ [−180, 180]; `station_id` dạng `ST-nn` | BR-04, mục 3 SRS |
| station_battery_stock | `available_batteries >= 0` | NFR-01, AE-13 |
| station_charging_port | `available_ports >= 0` | mục 6 SRS |
| reservation_draft | `quantity = 1`; `expires_at > created_at`; khóa ngoại tới trạm và nhóm pin | BR-05, BR-02 |
| reservation | `UNIQUE (draft_id)`; ràng buộc trạng thái: ACTIVE ⇒ không có mốc kết thúc; CANCELLED ⇒ `cancelled_at < expires_at`; EXPIRED ⇒ `expired_at >= expires_at` | BR-06, BR-09 |
| idempotency_record | Khóa chính theo phạm vi (người dùng, thao tác, khóa); `operation IN ('CONFIRM_RESERVATION')` | BR-08 |

Kiểu dữ liệu: tọa độ `NUMERIC(8,6)`/`NUMERIC(9,6)` để giữ đúng giá trị thập phân trong bộ dữ liệu mẫu; thời gian `TIMESTAMPTZ` theo giờ máy chủ; `draft_id`/`reservation_id` là `UUID` do máy chủ sinh.

### 3.4 Khung nhìn và chỉ mục

- `v_station_resource (station_id, service_type, family_code, available_count)`: hợp của hai bảng tài nguyên. Phép tìm kiếm lọc theo `service_type` và `family_code` trên khung nhìn này; các trường `services` và `supported_families` của JSON là phép chiếu của nó.
- `v_reservation_detail`: đơn kèm chủ sở hữu/trạm/nhóm/số lượng lấy từ bản nháp, đúng khái niệm “Đơn đặt pin” ở mục 6 SRS.
- Chỉ mục: `reservation (expires_at) WHERE status = 'ACTIVE'` cho tác vụ hết hạn; `reservation_draft (user_id)` cho “đơn của tôi”; `reservation_draft (station_id, family_code)`; `user_session (user_id)`.

### 3.5 Cách lược đồ hỗ trợ các giao dịch bắt buộc

Đây là gợi ý cho M2/M6 khi triển khai, không phải mã đã có. Bản chi tiết (thứ tự khóa, idempotency, worker) đã chốt ở [Reservation_Design.md §6](./Reservation_Design.md#6-giao-dịch-nguyên-tử) (2.1.3).

**Xác nhận (BR-07, BR-08)** — một giao dịch:

1. Tra `idempotency_record` theo (người dùng từ phiên, `CONFIRM_RESERVATION`, khóa). Có và `request_hash` khớp → trả đơn gốc (sau khi đối soát hết hạn). Có nhưng khác hash → xung đột khóa.
2. Kiểm tra bản nháp thuộc người dùng, chưa hết hạn, nội dung yêu cầu khớp bản nháp. Kiểm tra điều kiện đổi pin hiện tại của trạm theo thứ tự dịch vụ, nhóm, trạng thái trạm và tồn kho.
3. `UPDATE station_battery_stock SET available_batteries = available_batteries - 1 WHERE station_id = … AND family_code = … AND available_batteries >= 1`. Không có dòng nào được cập nhật → không khả dụng, hủy giao dịch.
4. `INSERT` vào `reservation` rồi `idempotency_record`. Vi phạm `UNIQUE (draft_id)` → bản nháp đã dùng; vi phạm khóa chính của `idempotency_record` → yêu cầu trùng khóa chạy đồng thời, đọc lại theo bước 1.

Hai xác nhận đồng thời cho viên pin cuối cùng (AE-13) tranh nhau khóa dòng ở bước 3: chỉ một bên cập nhật được.

**Hủy / hết hạn (BR-09)** — chuyển trạng thái có điều kiện, chỉ hoàn pin khi đúng một dòng được cập nhật:

```sql
UPDATE reservation SET status = 'CANCELLED', cancelled_at = :now
 WHERE reservation_id = :id AND status = 'ACTIVE' AND :now < expires_at;

UPDATE reservation SET status = 'EXPIRED', expired_at = :now
 WHERE reservation_id = :id AND status = 'ACTIVE' AND :now >= expires_at;
```

### 3.6 Migration

Lược đồ được quản lý bằng các tệp SQL đánh số trong [db/migrations/](../../db/migrations/), áp dụng theo thứ tự tên tệp trên một cơ sở dữ liệu trống.

| Tệp | Nội dung |
| --- | --- |
| [001_initial_schema.sql](../../db/migrations/001_initial_schema.sql) | 10 bảng, 4 chỉ mục, 2 khung nhìn của thiết kế v0 |
| [002_reservation_stock.sql](../../db/migrations/002_reservation_stock.sql) | Tách liên kết trạm và nhóm pin của bản nháp, bảo vệ dòng tồn kho khi còn đơn ACTIVE. [Bản SQLite](../../db/migrations/sqlite/002_reservation_stock.sql) áp dụng quy tắc tương ứng. |

Quy ước:

- Tên tệp có dạng `NNN_mo_ta.sql`, với `NNN` là số thứ tự ba chữ số tăng dần.
- Migration đã được người khác áp dụng thì không sửa nữa; mọi thay đổi lược đồ sau này là một tệp mới (`002_…`).
- Migration chỉ thay đổi cấu trúc. Dữ liệu mẫu nằm ở `db/seed.sql`, xóa dữ liệu nằm ở `db/reset.sql`.
- Chỉ có chiều tiến, chưa có tệp hoàn tác. Trên CSDL thử nghiệm, muốn quay lại thì tạo CSDL mới rồi áp dụng lại từ đầu.

Đây là các tệp SQL thuần, chưa gắn với công cụ migration nào. Nếu backend chọn công cụ riêng thì chuyển các tệp này sang định dạng của công cụ đó (chờ M2 chốt).

## 4. Chuẩn hóa

### 4.1 Dạng chưa chuẩn hóa (UNF)

Một bản ghi trạm trong JSON là:

```
STATION_RAW (station_id, name, area_label, lat, lng, opening_status,
             {services}, {supported_families},
             {family → available_batteries}, {family → available_charging_ports})
```

Bốn thuộc tính cuối là nhóm lặp (mảng và ánh xạ), nên chưa đạt 1NF. `services` và `supported_families` còn trùng thông tin với tập khóa của hai ánh xạ số lượng.

### 4.2 Dạng chuẩn 1 (1NF)

Trải các nhóm lặp thành giá trị nguyên tố, mỗi dòng là một tài nguyên của trạm:

```
STATION_1NF (station_id, service_type, family_code,
             name, area_label, lat, lng, opening_status, available_count)
Khóa: (station_id, service_type, family_code)
```

Phụ thuộc hàm:

- FD1: station_id → name, area_label, lat, lng, opening_status
- FD2: (station_id, service_type, family_code) → available_count

Bất thường: thông tin trạm lặp lại ở mọi dòng; không thể lưu trạm chưa có tài nguyên; đổi trạng thái trạm phải sửa nhiều dòng.

### 4.3 Dạng chuẩn 2 (2NF)

FD1 là phụ thuộc bộ phận vào khóa (chỉ cần `station_id`). Tách:

```
station          (station_id, name, area_label, lat, lng, opening_status)
station_resource (station_id, service_type, family_code, available_count)
```

Sau đó `station_resource` được tách ngang theo `service_type` thành `station_battery_stock` và `station_charging_port`. Đây là quyết định thiết kế chứ không phải yêu cầu của chuẩn hóa: hai bảng con đều giữ nguyên dạng chuẩn, quy tắc BR-02 được kiểm tra khi tạo và xác nhận bản nháp theo các dòng tồn kho hiện tại.

### 4.4 Dạng chuẩn 3 (3NF) và BCNF

Mỗi quan hệ dưới đây chỉ có các phụ thuộc hàm không tầm thường mà vế trái là siêu khóa, nên đạt BCNF (và do đó đạt 3NF).

| Quan hệ | Phụ thuộc hàm | Khóa ứng viên | Kết luận |
| --- | --- | --- | --- |
| battery_family | family_code → label, demo_vehicle_id; demo_vehicle_id → family_code, label | family_code; demo_vehicle_id | BCNF |
| station | station_id → name, area_label, lat, lng, opening_status | station_id | BCNF |
| station_battery_stock | (station_id, family_code) → available_batteries | (station_id, family_code) | BCNF |
| station_charging_port | (station_id, family_code) → available_ports | (station_id, family_code) | BCNF |
| app_user | user_id → created_at | user_id | BCNF |
| user_session | session_token_hash → user_id, created_at, expires_at, revoked_at | session_token_hash | BCNF |
| reservation_draft | draft_id → user_id, station_id, family_code, quantity, created_at, expires_at | draft_id | BCNF |
| reservation | reservation_id → draft_id, status, created_at, expires_at, cancelled_at, expired_at; draft_id → reservation_id, … | reservation_id; draft_id | BCNF |
| idempotency_record | (user_id, operation, idempotency_key) → request_hash, reservation_id, created_at; (operation, reservation_id) → user_id, idempotency_key, … | hai khóa ứng viên tương ứng | BCNF |
| demo_origin | origin_id → lat, lng | origin_id | BCNF |

Các điểm đã cân nhắc:

- **`area_label` trong station.** Không có phụ thuộc bắc cầu: nhãn khu vực chỉ là chuỗi minh họa gắn với từng trạm, không được xác định bởi thuộc tính không khóa nào khác, và nhãn không có thuộc tính riêng. Chưa cần bảng AREA; nếu sau này khu vực có thuộc tính riêng thì tách.
- **`name` trong station.** Tên hiện duy nhất trong dữ liệu mẫu nhưng yêu cầu không nêu quy tắc này, nên không khai báo là khóa ứng viên.
- **Không sao chép dữ liệu bản nháp sang đơn.** Nếu `reservation` chứa cả `user_id`, `station_id`, `family_code`, `quantity` thì quan hệ đó vẫn đạt BCNF (vì `draft_id` là khóa ứng viên), nhưng cùng một sự kiện sẽ được lưu ở hai bảng và có thể lệch nhau. Thiết kế chỉ giữ `draft_id` và đọc qua `v_reservation_detail`. Hệ quả: bản nháp đã dùng không được xóa khi đơn còn tồn tại, và bản nháp phải bất biến.
- **Không có cột “đã dùng” hay “trạng thái” ở bản nháp.** Đó là dữ liệu suy diễn từ sự tồn tại của đơn và từ `expires_at`; lưu thêm sẽ tạo nguy cơ mâu thuẫn. “Đánh dấu bản nháp đã dùng” trong BR-07 chính là thao tác chèn đơn dưới ràng buộc `UNIQUE (draft_id)`.
- **`cancelled_at`/`expired_at` so với `status`.** Trạng thái suy ra được từ hai mốc thời gian, nhưng `status` được giữ lại vì là tên chuẩn trong SRS và cần cho chỉ mục bộ phận. Ràng buộc `ck_reservation_state` buộc ba cột luôn nhất quán, nên không phát sinh bất thường cập nhật.
- **`user_id` trong idempotency_record.** Là một phần của khóa theo BR-08 nên không thừa. Việc nó phải trùng với chủ bản nháp của đơn là ràng buộc liên bảng, do giao dịch xác nhận bảo đảm.

### 4.5 Dạng chuẩn 4 (4NF)

Trong JSON, `services` và `supported_families` là hai tập đa trị độc lập của trạm. Nếu lưu chung trong một quan hệ `(station_id, service_type, family_code)` không có thuộc tính khác thì sẽ có phụ thuộc đa trị `station_id →→ service_type` và vi phạm 4NF. Lược đồ này không lưu hai tập đó: nó lưu sự kiện “trạm S có N tài nguyên của dịch vụ X cho nhóm F”, trong đó số lượng phụ thuộc vào cả bộ khóa. Không quan hệ nào có phụ thuộc đa trị không tầm thường, nên toàn bộ lược đồ đạt 4NF.

## 5. Nạp dữ liệu mẫu

[db/seed.sql](../../db/seed.sql) được sinh từ `seed_stations_v0.json` và chỉ chứa lệnh `INSERT` trong một giao dịch:

| Bảng | Số dòng | Nội dung |
| --- | ---: | --- |
| battery_family | 2 | FAM_A, FAM_B |
| app_user | 2 | USER-A, USER-B |
| demo_origin | 3 | LOC-01…LOC-03 |
| station | 18 | ST-01…ST-18 |
| station_battery_stock | 26 | 15 trạm có đổi pin |
| station_charging_port | 24 | 13 trạm có sạc |
| reservation_draft, reservation, idempotency_record, user_session | 0 | Trạng thái ban đầu rỗng |

### 5.1 Kiểm tra dữ liệu mẫu

[db/validate_seed.sql](../../db/validate_seed.sql) là một truy vấn chỉ đọc gồm 38 phép kiểm tra; mọi dòng phải có `result = 'PASS'`.

| Nhóm | Nội dung kiểm tra |
| --- | --- |
| Tọa độ (C1–C5) | Vĩ độ/kinh độ trong miền hợp lệ; 18 trạm nằm trong khung minh họa khu vực Hà Nội và không trùng tọa độ; ST-01 trùng LOC-01 |
| Dịch vụ (S1–S9) | 16 trạm OPEN, ST-09 CLOSED, ST-13 MAINTENANCE; không trạm nào thiếu dịch vụ; 15 trạm đổi pin, 13 trạm sạc; ST-02/ST-07/ST-17 chỉ có sạc |
| Tương thích (F1–F5) | ST-03/ST-15 chỉ đổi pin nhóm A, ST-04/ST-12 chỉ nhóm B; trạm có cả hai dịch vụ hỗ trợ cùng tập nhóm ở cả hai |
| Tồn kho (K1–K11) | Không có số lượng âm; tổng 68 pin A, 54 pin B, 66 cổng sạc; ST-05 hỗ trợ A nhưng 0 pin; ST-09 có số lượng dương; ST-13 toàn 0 |
| Trạng thái rỗng (E1–E4) | Không có bản nháp, đơn, bản ghi chống lặp hay phiên |

Khung tọa độ ở C3 chỉ là phép kiểm tra hợp lý cho dữ liệu mẫu, không phải quy tắc lúc chạy (SRS mục 3).

### 5.2 Đặt lại lặp lại được

[db/reset.sql](../../db/reset.sql) xóa mọi dòng của cả 10 bảng theo thứ tự khóa ngoại trong một giao dịch. Đặt lại = chạy `reset.sql` rồi `seed.sql`;

```
psql -d <db_thử_nghiệm> -v ON_ERROR_STOP=1 -f db/migrations/001_initial_schema.sql -f db/migrations/002_reservation_stock.sql -f db/seed.sql   # lần đầu, trên CSDL trống
psql -d <db_thử_nghiệm> -f db/reset.sql  -f db/seed.sql        # đặt lại sau mỗi ca kiểm thử
psql -d <db_thử_nghiệm> -f db/validate_seed.sql                # kiểm tra
```

### 5.3 Kết quả chạy thử

| Môi trường | Cách chạy | Kết quả |
| --- | --- | --- |
| PostgreSQL 18, CSDL riêng `vinergy_test` | Chạy thủ công bằng psql ngày 16/11/2026 | `001_initial_schema.sql` (khi đó tên là `schema.sql`, nội dung không đổi) tạo đủ 10 bảng, không lỗi; `validate_seed.sql` đạt 38/38; sau khi làm bẩn dữ liệu, `reset.sql` + `seed.sql` đưa về 38/38 |
| SQLite 3.40 trong bộ nhớ | `python db/check_seed.py` | 38/38; 18 trạm khớp JSON; ba vòng đặt lại cho trạng thái giống hệt ban đầu |

Chưa kiểm tra hành vi đồng thời (AE-11, AE-13, AE-16d), vì cần mã giao dịch của Sprint 2.
