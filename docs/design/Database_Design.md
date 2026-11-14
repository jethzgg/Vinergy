# Vinergy — Thiết kế cơ sở dữ liệu

Phiên bản 0.1. Cập nhật ngày 14 tháng 11 năm 2026. **Bản nháp — đang chờ M2/M4/M7 rà soát.** Thuộc WBS 1.1.3 (EN-101). Nguồn yêu cầu: [SRS](../requirements/SRS.md), [danh sách yêu cầu sản phẩm](../requirements/Product_Backlog.md), [ví dụ nghiệm thu](../requirements/Acceptance_Examples_and_Sample_Data.md) và [seed_stations_v0.json](../../data/seed_stations_v0.json).

Sản phẩm kèm theo: [db/schema.sql](../../db/schema.sql) (lược đồ) và [db/seed.sql](../../db/seed.sql) (18 trạm mẫu). Tài liệu đi theo bốn bước: **Yêu cầu → Mô hình ER → Lược đồ quan hệ → Chuẩn hóa**.

DBMS mục tiêu là PostgreSQL 14+ (đề xuất, chưa được nhóm chốt). Lược đồ chỉ dùng SQL chuẩn nên cũng chạy được trên SQLite. Lược đồ và dữ liệu mẫu **đã được chạy thử trên SQLite 3.40**; **chưa chạy trên PostgreSQL** vì máy soạn thảo không có PostgreSQL.

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

### 1.4 Ngoài phạm vi thiết kế này

Không lưu nội dung hội thoại, vị trí chính xác của người dùng hay nhật ký (NFR-04; chính sách lưu giữ còn mở). Không có đặt cổng sạc, thanh toán, bàn giao pin thực tế. Không lưu tổng dung lượng pin của trạm vì bộ dữ liệu mẫu không có trường này.

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
| R5 | **TARGETS** (nhắm tới) | RESERVATION_DRAFT — STOCKS_BATTERY | N : 1 | Bản nháp bắt buộc trỏ tới đúng một cặp (trạm, nhóm) **có hỗ trợ đổi pin**; một cặp có 0..N bản nháp | — |
| R6 | **CONFIRMED_AS** (được xác nhận thành) | RESERVATION_DRAFT — RESERVATION | 1 : 1 | Đơn bắt buộc có đúng một bản nháp; bản nháp có 0..1 đơn | — |
| R7 | **OWNS_KEY** (quan hệ định danh) | APP_USER — IDEMPOTENCY_RECORD | 1 : N | Bản ghi bắt buộc có người dùng | — |
| R8 | **RESULTED_IN** (cho kết quả) | IDEMPOTENCY_RECORD — RESERVATION | 1 : 1 | Bản ghi bắt buộc trỏ tới đúng một đơn; mỗi đơn có đúng một bản ghi thao tác xác nhận | — |

Ghi chú khi vẽ:

- R5 nối bản nháp với **mối quan hệ R1** (thực thể kết hợp / aggregation), không nối trực tiếp với STATION và BATTERY_FAMILY. Nhờ đó mô hình tự loại trường hợp nháp ở trạm chỉ sạc hoặc nhóm không tương thích (AE-02, AE-03). Nếu ký pháp của bạn không có aggregation, hãy vẽ R1 thành thực thể kết hợp STATION_BATTERY_STOCK.
- RESERVATION **không** có quan hệ trực tiếp với APP_USER, STATION hay BATTERY_FAMILY: chủ sở hữu, trạm và nhóm của đơn được xác định qua bản nháp (R6 → R4, R5).
- Vòng đời `ACTIVE → CANCELLED | EXPIRED` là thuộc tính `status` của RESERVATION, không phải thực thể riêng.
- DEMO_ORIGIN không có mối quan hệ nào.

## 3. Lược đồ quan hệ

### 3.1 Quy tắc ánh xạ đã áp dụng

| Thành phần ER | Cách ánh xạ |
| --- | --- |
| Thực thể mạnh | Một quan hệ; thuộc tính phức hợp tọa độ tách thành `lat`, `lng` |
| R1, R2 (M:N có thuộc tính) | Quan hệ riêng, khóa chính là cặp khóa ngoại (station_id, family_code) |
| R3, R4, R5 (1:N) | Khóa ngoại đặt ở phía N; R5 dùng khóa ngoại kép tới quan hệ của R1 |
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
                      FK (station_id, family_code) → station_battery_stock

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
| reservation_draft | `quantity = 1`; `expires_at > created_at`; khóa ngoại kép tới tồn kho pin | BR-05, BR-02 |
| reservation | `UNIQUE (draft_id)`; ràng buộc trạng thái: ACTIVE ⇒ không có mốc kết thúc; CANCELLED ⇒ `cancelled_at < expires_at`; EXPIRED ⇒ `expired_at >= expires_at` | BR-06, BR-09 |
| idempotency_record | Khóa chính theo phạm vi (người dùng, thao tác, khóa); `operation IN ('CONFIRM_RESERVATION')` | BR-08 |

Kiểu dữ liệu: tọa độ `NUMERIC(8,6)`/`NUMERIC(9,6)` để giữ đúng giá trị thập phân trong bộ dữ liệu mẫu; thời gian `TIMESTAMPTZ` theo giờ máy chủ; `draft_id`/`reservation_id` là `UUID` do máy chủ sinh.

### 3.4 Khung nhìn và chỉ mục

- `v_station_resource (station_id, service_type, family_code, available_count)`: hợp của hai bảng tài nguyên. Phép tìm kiếm lọc theo `service_type` và `family_code` trên khung nhìn này; các trường `services` và `supported_families` của JSON là phép chiếu của nó.
- `v_reservation_detail`: đơn kèm chủ sở hữu/trạm/nhóm/số lượng lấy từ bản nháp, đúng khái niệm “Đơn đặt pin” ở mục 6 SRS.
- Chỉ mục: `reservation (expires_at) WHERE status = 'ACTIVE'` cho tác vụ hết hạn; `reservation_draft (user_id)` cho “đơn của tôi”; `reservation_draft (station_id, family_code)`; `user_session (user_id)`.

### 3.5 Cách lược đồ hỗ trợ các giao dịch bắt buộc

Đây là gợi ý cho M2/M6 khi triển khai, không phải mã đã có.

**Xác nhận (BR-07, BR-08)** — một giao dịch:

1. Tra `idempotency_record` theo (người dùng từ phiên, `CONFIRM_RESERVATION`, khóa). Có và `request_hash` khớp → trả đơn gốc (sau khi đối soát hết hạn). Có nhưng khác hash → xung đột khóa.
2. Kiểm tra bản nháp thuộc người dùng, chưa hết hạn, nội dung yêu cầu khớp bản nháp, trạm `OPEN`.
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

Sau đó `station_resource` được tách ngang theo `service_type` thành `station_battery_stock` và `station_charging_port`. Đây là quyết định thiết kế chứ không phải yêu cầu của chuẩn hóa: hai bảng con đều giữ nguyên dạng chuẩn, đổi lại khóa ngoại của bản nháp bảo đảm được BR-02 mà không cần cột hằng `service_type = 'SWAPPING'`.

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

Cách chạy trên cơ sở dữ liệu thử nghiệm **trống**: `psql -d <db_thử_nghiệm> -f db/schema.sql -f db/seed.sql`.

Tệp không xóa hay đặt lại dữ liệu; chạy lần hai sẽ lỗi trùng khóa và không ghi gì. Công cụ đặt lại có bảo vệ theo FR-13/AE-22 là việc của EN-104 (M1), chưa có ở đây.

Đã kiểm tra trên SQLite bằng một kịch bản tạm (không nằm trong kho mã):

- Dựng lại cả 18 bản ghi từ CSDL cho kết quả trùng với JSON, gồm `services` và `supported_families` suy ra từ khung nhìn.
- AE-01 cho thứ tự ST-01, ST-03, ST-05, ST-06 với 0.0/0.9/1.3/1.7 km; AE-18 chọn ST-03 ở 1.161907 km; AE-02, AE-03, AE-07e, AE-07f cho đúng tập trạm.
- CSDL từ chối: tồn kho âm, bản nháp tại ST-02 (chỉ sạc) và ST-04/FAM_A (không tương thích), `quantity = 2`, đơn thứ hai trên cùng bản nháp, `CANCELLED` tại/sau hạn, `EXPIRED` trước hạn.

Chưa kiểm tra: hành vi đồng thời thật (AE-11, AE-13, AE-16d) — cần PostgreSQL và mã giao dịch của Sprint 2.

## 6. Điểm cần nhóm rà soát

| Điểm | Lựa chọn trong bản nháp | Người rà soát |
| --- | --- | --- |
| DBMS | PostgreSQL 14+ | M2/M4 |
| Phiên demo | Bảng `user_session` tối thiểu, chờ đặc tả phiên ở 1.1.2 | M2/M4 |
| “Phiên bản” bản nháp | Bản nháp bất biến; thay đổi trạm/nhóm tạo `draft_id` mới thay cho cột revision. SRS mục 6 ghi “revision/token” nên cần M2 xác nhận | M1/M2 |
| Phạm vi hỗ trợ nhóm | Lược đồ cho phép một trạm hỗ trợ nhóm khác nhau cho sạc và đổi pin; JSON hiện khai báo `supported_families` chung cho cả trạm. Dữ liệu mẫu thỏa cả hai cách hiểu | M4 |
| Giới hạn một đơn hoạt động mỗi người | Chưa có ràng buộc, đúng với quyết định còn mở ở mục 8 SRS. Nếu chốt, cần thêm cột chủ sở hữu vào `reservation` để tạo chỉ mục duy nhất bộ phận | M1/M2 |
| Thời hạn bản nháp/giữ pin | Không có giá trị mặc định trong CSDL; máy chủ truyền `expires_at` | M1/M2/M4 |
