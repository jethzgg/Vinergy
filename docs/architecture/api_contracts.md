# Vinergy — Hợp đồng API & LLM Tool (v2.2 — Sprint 1 + đặt pin Sprint 2)

> **Trạng thái:** §1–§5 v1.0 rev 2 (Task 1.1.2, M2). §6 Draft v2.2 (Task 2.1.3, M4 — Bui Quang Minh), chờ rà soát cùng M1, M2, M3, M6 | **Phụ trách:** M2 (Vu Duy Quang) và M4  
> **Tham chiếu:** [architecture.md](./architecture.md), [tool_schemas.json](./tool_schemas.json), [SRS.md](../requirements/SRS.md), [Acceptance_Examples_and_Sample_Data.md](../requirements/Acceptance_Examples_and_Sample_Data.md), [seed_stations_v0.json](../../data/seed_stations_v0.json)  
> **Phạm vi:** Hợp đồng Sprint 1 (§1–§5) và hợp đồng đặt pin Sprint 2 (§6, thiết kế ở [Reservation_Design.md](../design/Reservation_Design.md)). Thêm endpoint là thay đổi tương thích nên vẫn dùng base path `/api/v1`. Mọi ví dụ trong tài liệu được tính từ dữ liệu seed và khớp với giá trị đối chiếu của AE.

---

## 1. Quy ước chung

| Mục | Quy ước |
| --- | --- |
| Base path | `/api/v1`. Thay đổi phá vỡ tương thích (xóa hoặc đổi tên trường, đổi kiểu, đổi ý nghĩa) phải lên `/api/v2`. Thêm trường mới vào response là thay đổi tương thích; client phải bỏ qua trường lạ. |
| Định dạng | JSON UTF-8, `Content-Type: application/json; charset=utf-8`. Tên trường dùng `snake_case`. |
| Thời gian | ISO 8601 UTC, ví dụ `2026-11-20T08:30:00Z`. |
| Request ID | Mọi response có header `X-Request-Id` do server sinh. Body lỗi lặp lại giá trị này ở `request_id`. |
| Cache | Response chứa dữ liệu trạm hoặc tồn kho có `Cache-Control: no-store`. |
| Nhãn mô phỏng | Mọi response chứa dữ liệu trạm có `"is_simulated": true` (BR-01). UI hiển thị thông báo: **"Dữ liệu mô phỏng — việc đặt pin không có hiệu lực tại các trạm thực tế."** |
| Phân trang | Không có, và đây là chủ ý vì bộ dữ liệu chỉ có 18 trạm. Nếu sau này cần, phân trang sẽ được thêm dưới dạng tham số tùy chọn để giữ tương thích. |
| Xác thực | Endpoint trạm (§4) công khai, không cần phiên. Endpoint chat và đặt pin bắt buộc có phiên demo (§3). |

### 1.1. Khoảng cách (BR-04)

- Công thức Haversine, R = 6371 km, góc tính bằng radian:  
  `a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)`; `distance_km = 2 · 6371 · asin(min(1, √a))`.
- `distance_km` (number): độ chính xác đầy đủ (IEEE-754 double), **không làm tròn** trong response. Dùng để so với bán kính (`distance_km <= radius_km`) và để sắp xếp.
- `distance_display` (string): `distance_km` làm tròn half-up tới 1 chữ số thập phân, cộng hậu tố `" km"`, ví dụ `"0.9 km"` (chuẩn hóa `-0` thành `"0.0 km"`). Trường này chỉ để hiển thị, không dùng để sắp xếp hay so sánh.
- Thứ tự sắp xếp: `distance_km` tăng dần. Nếu bằng nhau tuyệt đối thì xếp theo `station_id` tăng dần (so sánh chuỗi theo mã ký tự).

### 1.2. Quy tắc đọc tham số query

Áp dụng cho mọi endpoint `GET`. Vi phạm trả `400 INVALID_INPUT` với `reason` tương ứng (§2.3).

| Loại | Chấp nhận | Từ chối (`reason`) |
| --- | --- | --- |
| Mọi tham số có giá trị rỗng | — | `?lat=`, `?service_type=`, `?only_open=` (`EMPTY`) |
| number | Khớp `^-?\d+(\.\d+)?$` và hữu hạn sau khi parse (`-0` chuẩn hóa thành `0`) | `abc`, `21abc`, `1e3`, `+1`, `.5`, ` 21`, `NaN`, `Infinity` (`NOT_A_NUMBER`) |
| boolean | Đúng chuỗi `true` hoặc `false` | `1`, `0`, `yes`, `TRUE` (`NOT_BOOLEAN`) |
| enum | Đúng giá trị liệt kê, phân biệt hoa thường | `swapping`, `BOTH` (`NOT_IN_ENUM`) |
| Mọi tham số | Xuất hiện tối đa một lần | `?lat=1&lat=2` (`DUPLICATE_PARAM`, `field` là tên tham số lặp) |
| Tham số lạ | — | Tên không có trong bảng của endpoint, ví dụ `radius=5` (`UNKNOWN_PARAM`, `field` là tên tham số lạ) |

- Validator thu thập **toàn bộ** lỗi, không dừng ở lỗi đầu tiên. `details` sắp theo thứ tự tham số trong bảng của endpoint, sau đó tới tham số lạ theo thứ tự xuất hiện.
- Lưu ý khi cài bằng JavaScript: không dùng `Number()` hoặc `parseFloat()` trực tiếp (`Number("") === 0`, `parseFloat("21abc") === 21`), và không xét truthiness cho boolean (`"false"` là truthy).

### 1.3. Quy tắc body JSON và thứ tự middleware

- Với mọi endpoint nhận JSON body (§3.1, §5.6, §6): JSON sai cú pháp trả `400 INVALID_INPUT` (`details: []`). Số phải có kiểu JSON `number` và hữu hạn (không tự ép chuỗi `"21"` hoặc `"1"`). Chuỗi phải có kiểu JSON `string`. Trường không khai báo bị từ chối với `UNKNOWN_FIELD`.
- **Thứ tự xử lý request** (để mã HTTP luôn xác định khi có nhiều lỗi cùng lúc):
  1. Routing (`404 ROUTE_NOT_FOUND`)
  2. Phiên demo nếu endpoint yêu cầu (`401 SESSION_REQUIRED` / `SESSION_EXPIRED`)
  3. `Content-Type` nếu request có body (`415 UNSUPPORTED_MEDIA_TYPE`)
  4. `X-CSRF-Token` cho thao tác ghi có phiên (`403 CSRF_INVALID`)
  5. Rate limit (`429 RATE_LIMITED`)
  6. Validate tham số path/query/body (`400 INVALID_INPUT`)
  7. Xử lý nghiệp vụ / dữ liệu (`404` / `409`)

---

## 2. Lỗi

### 2.1. Error envelope

Kết quả rỗng hợp lệ là `200 OK` với `stations: []`, khác hoàn toàn với lỗi `4xx`/`5xx` (AE-05). Mọi lỗi dùng chung một cấu trúc:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Một hoặc nhiều tham số không hợp lệ.",
    "details": [
      { "field": "lat", "reason": "REQUIRED", "message": "lat là bắt buộc." },
      { "field": "radius_km", "reason": "NOT_POSITIVE", "message": "radius_km phải lớn hơn 0." }
    ]
  },
  "request_id": "req_01JCXZ7Q8M4V6T2N9P3R5S7W1Y"
}
```

- `message` an toàn để hiển thị: không chứa stack trace, câu SQL hay giá trị bí mật.
- `details` là mảng rỗng khi lỗi không gắn với trường cụ thể.

### 2.2. Bảng mã lỗi

Mỗi `code` gắn với đúng một HTTP status.

| HTTP | `error.code` | Khi nào | Áp dụng từ |
| --- | --- | --- | --- |
| `400` | `INVALID_INPUT` | Tham số query, path hoặc body sai theo §1.2 và §2.3 (AE-07) | Sprint 1 |
| `401` | `SESSION_REQUIRED` | Endpoint cần phiên nhưng thiếu cookie hoặc phiên không tồn tại | Sprint 1 |
| `401` | `SESSION_EXPIRED` | Phiên đã quá `expires_at` (AE-23f) | Sprint 1 |
| `403` | `CSRF_INVALID` | Request thay đổi trạng thái thiếu hoặc sai `X-CSRF-Token` | Sprint 1 |
| `404` | `STATION_NOT_FOUND` | `station_id` đúng định dạng nhưng không tồn tại | Sprint 1 |
| `404` | `ROUTE_NOT_FOUND` | Path hoặc method không tồn tại (gồm cả `/demo-session` khi `DEMO_LOGIN_ENABLED=false`) | Sprint 1 |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Body không phải `application/json` | Sprint 1 |
| `429` | `RATE_LIMITED` | Vượt `LLM_RATE_LIMIT_PER_MINUTE` của phiên; kèm header `Retry-After` | Spike S1 / S3 |
| `500` | `INTERNAL_ERROR` | Lỗi không lường trước hoặc lỗi DB | Sprint 1 |
| `503` | `UPSTREAM_UNAVAILABLE` | LLM provider trả lỗi hoặc không kết nối được (AE-21) | Spike S1 / S3 |
| `504` | `UPSTREAM_TIMEOUT` | LLM provider vượt `LLM_TIMEOUT_MS` (AE-21) | Spike S1 / S3 |

Mã lỗi đặt pin (Sprint 2) nằm ở §6.11.

### 2.3. Mã `reason` trong `details`

| `reason` | Ý nghĩa |
| --- | --- |
| `REQUIRED` | Thiếu tham số hoặc trường bắt buộc |
| `EMPTY` | Có tham số nhưng giá trị rỗng |
| `NOT_A_NUMBER` | Không phải số hợp lệ (sai định dạng §1.2, sai kiểu JSON `number` hoặc không hữu hạn) |
| `OUT_OF_RANGE` | `lat` ngoài `[-90, 90]` hoặc `lng` ngoài `[-180, 180]` |
| `NOT_POSITIVE` | `radius_km <= 0` |
| `NOT_BOOLEAN` | Không phải `true`/`false` |
| `NOT_IN_ENUM` | Không thuộc tập giá trị cho phép |
| `INVALID_FORMAT` | Sai định dạng chuỗi hoặc kiểu dữ liệu (ví dụ `station_id`, object thay cho string) |
| `TOO_LONG` | Chuỗi vượt độ dài tối đa cho phép (ví dụ `message` > 1000 ký tự) |
| `DUPLICATE_PARAM` | Tham số xuất hiện nhiều lần |
| `UNKNOWN_PARAM` | Tham số query không được định nghĩa |
| `UNKNOWN_FIELD` | Trường JSON body không được định nghĩa |
| `MISSING_PAIR` | Chỉ có một trong hai tham số `lat`/`lng` ở endpoint mà chúng là tùy chọn (`field` là tên tham số bị thiếu) |
| `MUST_BE_ONE` | `quantity` là số nhưng không phải đúng số nguyên `1` (BR-05) |
| `ONE_OF_REQUIRED` | Thiếu cả hai trường mà phải có đúng một (`station_id` / `nearest`) |
| `MUTUALLY_EXCLUSIVE` | Có cùng lúc hai trường chỉ được có một |
| `DRAFT_EXPIRED` | Trong `DRAFT_STALE`: bản nháp đã quá `expires_at` |
| `CONTENT_MISMATCH` | Trong `DRAFT_STALE`: body xác nhận lệch nội dung bản nháp |
| `CHARGING_ONLY`, `UNSUPPORTED_FAMILY`, `STATION_CLOSED`, `STATION_MAINTENANCE`, `OUT_OF_STOCK` | Trong `STATION_NOT_ELIGIBLE`: đúng giá trị `ineligibility_reason` của §4.2 |

**Quy tắc phía client (FR-12):** phân biệt bốn trạng thái: `200` có kết quả, `200` rỗng, `4xx`/`5xx`, và lỗi mạng hoặc timeout. Không bao giờ hiển thị lỗi như một kết quả rỗng.

---

## 3. Phiên demo (hợp đồng ban đầu theo SRS §8)

Thiết kế và lý do: [architecture.md §6](./architecture.md#6-phiên-demo--bảo-mật).

### 3.1. `POST /api/v1/demo-session`

Chọn người dùng demo. Đây là bước "đăng nhập" của bản demo; sau bước này, danh tính chỉ đến từ cookie. Endpoint chỉ được đăng ký khi `DEMO_LOGIN_ENABLED=true` và không yêu cầu CSRF.

Request body:

```json
{ "demo_user": "USER-A" }
```

| Trường | Kiểu | Bắt buộc | Quy tắc |
| --- | --- | --- | --- |
| `demo_user` | string | Có | Enum `USER-A` \| `USER-B` |

Response `201 Created`, kèm header `Set-Cookie: vinergy_sid=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`:

```json
{
  "session": { "demo_user": "USER-A", "expires_at": "2026-11-13T17:30:00Z" },
  "csrf_token": "c3JmXzAxSkNYWjdROE00VjZUMk45UDNSNVM3VzFZ"
}
```

- `Max-Age` bằng `SESSION_TTL_MINUTES × 60`.
- Gọi lại khi đang có phiên sẽ hủy phiên cũ và tạo session id cùng CSRF token mới.

### 3.2. `GET /api/v1/demo-session`

Trả `200` với cùng cấu trúc như §3.1 để client lấy lại `csrf_token` sau khi tải lại trang. Nếu không có phiên trả `401 SESSION_REQUIRED`; nếu phiên hết hạn trả `401 SESSION_EXPIRED`.

### 3.3. `DELETE /api/v1/demo-session`

Yêu cầu `X-CSRF-Token`. Hủy phiên, xóa cookie, trả `204 No Content`.

### 3.4. Quy tắc chung

- Endpoint cần phiên: `POST /api/v1/chat` và toàn bộ endpoint đặt pin (§6).
- Mọi `user_id`, `owner` hay `demo_user` xuất hiện trong body, query hoặc tham số tool **không bao giờ** được dùng để phân quyền (BR-10, AE-14). Ở endpoint HTTP, chúng là trường/tham số không khai báo nên bị từ chối `UNKNOWN_FIELD`/`UNKNOWN_PARAM` theo §1.2, §1.3 (trừ `demo_user` của §3.1).
- Mọi `POST`/`PUT`/`PATCH`/`DELETE` có phiên đều bắt buộc header `X-CSRF-Token`, trừ §3.1.

---

## 4. Endpoints trạm (Sprint 1)

### 4.1. Đối tượng `Station`

Dùng chung cho §4.3, §4.4 và kết quả tool. Mọi trường luôn có mặt; trường không tính được trả `null`.

| Trường | Kiểu | Ghi chú |
| --- | --- | --- |
| `station_id` | string | Khớp `^[A-Z0-9-]{1,32}$`, ví dụ `ST-01` |
| `name` | string | Tên giả lập |
| `area_label` | string | Nhãn khu vực minh họa |
| `coordinates` | `{ "lat": number, "lng": number }` | Tọa độ gần đúng, chỉ minh họa |
| `opening_status` | `OPEN` \| `CLOSED` \| `MAINTENANCE` | Trạng thái mô phỏng; không suy ra giờ mở cửa |
| `services` | array của `CHARGING` \| `SWAPPING` | Không rỗng, không trùng; không có giá trị `BOTH` (BR-02) |
| `supported_families` | array của `FAM_A` \| `FAM_B` | Khả năng tương thích, độc lập với tồn kho (BR-03) |
| `available_batteries_by_family` | object `family → integer ≥ 0` | Chỉ có khóa cho nhóm được hỗ trợ đổi pin. `{}` nghĩa là trạm không có `SWAPPING`. **Khóa vắng mặt khác giá trị `0`**; server không được tự điền `0`. |
| `available_charging_ports_by_family` | object `family → integer ≥ 0` | Quy tắc tương tự cho `CHARGING`. Chỉ để hiển thị; đặt pin không bao giờ làm giảm số cổng sạc. |
| `distance_km` | number \| null | Search: luôn có. Detail: `null` nếu không truyền `lat`/`lng`. |
| `distance_display` | string \| null | Cùng điều kiện với `distance_km` |
| `family_supported` | boolean \| null | `supported_families` có chứa `family_code` hay không. Search: luôn `true` vì đã lọc. Detail: `null` nếu không truyền `family_code`. |
| `booking_eligible` | boolean \| null | Theo §4.2. `null` khi không có `family_code`. |
| `ineligibility_reason` | enum \| null | Theo §4.2. `null` khi `booking_eligible` là `true` hoặc `null`. |

### 4.2. Thuật toán điều kiện đặt pin

`booking_eligible` luôn trả lời câu hỏi: *"Có thể đặt 1 pin đổi (`SWAPPING`) cho `family_code` này tại trạm này ngay lúc này không?"* Kết quả **không phụ thuộc** `service_type` đang tìm. Nhờ vậy, khi người dùng tìm trạm sạc rồi muốn đặt pin (AE-19), giá trị vẫn nhất quán.

Xét theo thứ tự, dừng ở điều kiện đầu tiên đúng:

```text
1. "SWAPPING" không có trong services                     → false, CHARGING_ONLY
2. family_code không có trong supported_families          → false, UNSUPPORTED_FAMILY
3. opening_status == "CLOSED"                             → false, STATION_CLOSED
4. opening_status == "MAINTENANCE"                        → false, STATION_MAINTENANCE
5. available_batteries_by_family[family_code] < 1
   (hoặc khóa vắng mặt)                                   → false, OUT_OF_STOCK
6. Còn lại                                                → true,  null
```

- Lý do cố định (trạm không bao giờ đặt được) đứng trước lý do tạm thời (đóng cửa, bảo trì, hết pin). Thứ tự này cố định để mọi thành viên cài ra cùng một kết quả.
- Giá trị phản ánh dữ liệu tại thời điểm đọc. Bước xác nhận đặt pin luôn kiểm tra lại một cách nguyên tử (BR-07).

**Bảng đối chiếu từ dữ liệu seed** (`family_code = FAM_A`), dùng làm test oracle:

| Trạm | Ngữ cảnh | `family_supported` | `booking_eligible` | `ineligibility_reason` | AE |
| --- | --- | --- | --- | --- | --- |
| ST-01 | Search `SWAPPING` | `true` | `true` | `null` | AE-01 |
| ST-05 | Search `SWAPPING` | `true` | `false` | `OUT_OF_STOCK` | AE-01, AE-02 |
| ST-02 | Search `CHARGING` | `true` | `false` | `CHARGING_ONLY` | AE-03 |
| ST-01 | Search `CHARGING` | `true` | `true` | `null` | AE-19 |
| ST-04 | Detail với `family_code=FAM_A` | `false` | `false` | `UNSUPPORTED_FAMILY` | AE-02 |
| ST-09 | Search `SWAPPING`, `only_open=false` | `true` | `false` | `STATION_CLOSED` | AE-07e |
| ST-13 | Search `SWAPPING`, `only_open=false` | `true` | `false` | `STATION_MAINTENANCE` (dù tồn kho bằng 0) | AE-07e |

### 4.3. Tìm kiếm và lọc trạm — `GET /api/v1/stations`

Dùng cho màn hình tìm kiếm và bản đồ (1.2.2, 1.2.3), đồng thời là nghiệp vụ phía sau tool `search_stations` (§5).

#### Query parameters

| Tham số | Kiểu | Bắt buộc | Mặc định | Quy tắc |
| --- | --- | --- | --- | --- |
| `lat` | number | Có | — | Hữu hạn, trong `[-90, 90]` |
| `lng` | number | Có | — | Hữu hạn, trong `[-180, 180]` |
| `service_type` | enum | Có | — | `CHARGING` \| `SWAPPING` |
| `family_code` | enum | Có | — | `FAM_A` \| `FAM_B` |
| `only_open` | boolean | Không | `true` | `true` thì chỉ trả trạm có `opening_status` là `OPEN` |
| `radius_km` | number | Không | không giới hạn | Nếu có thì phải `> 0` và hữu hạn. Không truyền nghĩa là xét toàn bộ trạm, không có bán kính mặc định ẩn. Khi tìm theo mức pin, cự ly còn lại được truyền thẳng vào đây. |

#### Điều kiện lọc (BR-02, BR-03)

Một trạm xuất hiện trong `stations` khi thỏa **đồng thời**:

1. `services` chứa `service_type`.
2. `supported_families` chứa `family_code`. Bước này không xét tồn kho: trạm tương thích nhưng hết pin vẫn xuất hiện.
3. Nếu `only_open = true` thì `opening_status` phải là `OPEN`.
4. Nếu có `radius_km` thì `distance_km <= radius_km`.

Sau khi lọc, sắp xếp theo §1.1 và tính `booking_eligible` theo §4.2. `total` bằng số phần tử của `stations`. `query` lặp lại các giá trị đã chuẩn hóa, gồm cả giá trị mặc định (`radius_km: null` khi không truyền).

#### Response `200 OK` — kịch bản AE-01

`GET /api/v1/stations?lat=21.005&lng=105.8435&service_type=SWAPPING&family_code=FAM_A&radius_km=2`

```json
{
  "is_simulated": true,
  "query": {
    "lat": 21.005,
    "lng": 105.8435,
    "service_type": "SWAPPING",
    "family_code": "FAM_A",
    "only_open": true,
    "radius_km": 2
  },
  "total": 4,
  "stations": [
    {
      "station_id": "ST-01",
      "name": "Vinergy Demo Station 01",
      "area_label": "Hai Ba Trung demo area",
      "coordinates": { "lat": 21.005, "lng": 105.8435 },
      "opening_status": "OPEN",
      "services": ["CHARGING", "SWAPPING"],
      "supported_families": ["FAM_A", "FAM_B"],
      "available_batteries_by_family": { "FAM_A": 6, "FAM_B": 4 },
      "available_charging_ports_by_family": { "FAM_A": 3, "FAM_B": 2 },
      "distance_km": 0.0,
      "distance_display": "0.0 km",
      "family_supported": true,
      "booking_eligible": true,
      "ineligibility_reason": null
    },
    {
      "station_id": "ST-03",
      "name": "Vinergy Demo Station 03",
      "area_label": "Hai Ba Trung demo area",
      "coordinates": { "lat": 21.0115, "lng": 105.8492 },
      "opening_status": "OPEN",
      "services": ["SWAPPING"],
      "supported_families": ["FAM_A"],
      "available_batteries_by_family": { "FAM_A": 8 },
      "available_charging_ports_by_family": {},
      "distance_km": 0.9340655580626385,
      "distance_display": "0.9 km",
      "family_supported": true,
      "booking_eligible": true,
      "ineligibility_reason": null
    },
    {
      "station_id": "ST-05",
      "name": "Vinergy Demo Station 05",
      "area_label": "Hai Ba Trung demo area",
      "coordinates": { "lat": 21.0032, "lng": 105.856 },
      "opening_status": "OPEN",
      "services": ["CHARGING", "SWAPPING"],
      "supported_families": ["FAM_A", "FAM_B"],
      "available_batteries_by_family": { "FAM_A": 0, "FAM_B": 3 },
      "available_charging_ports_by_family": { "FAM_A": 2, "FAM_B": 2 },
      "distance_km": 1.3129277443639613,
      "distance_display": "1.3 km",
      "family_supported": true,
      "booking_eligible": false,
      "ineligibility_reason": "OUT_OF_STOCK"
    },
    {
      "station_id": "ST-06",
      "name": "Vinergy Demo Station 06",
      "area_label": "Dong Da demo area",
      "coordinates": { "lat": 21.0075, "lng": 105.8278 },
      "opening_status": "OPEN",
      "services": ["CHARGING", "SWAPPING"],
      "supported_families": ["FAM_A", "FAM_B"],
      "available_batteries_by_family": { "FAM_A": 5, "FAM_B": 3 },
      "available_charging_ports_by_family": { "FAM_A": 2, "FAM_B": 1 },
      "distance_km": 1.653277827241357,
      "distance_display": "1.7 km",
      "family_supported": true,
      "booking_eligible": true,
      "ineligibility_reason": null
    }
  ]
}
```

Test so sánh `distance_km` với giá trị đối chiếu của AE theo sai số tuyệt đối ≤ 1e-6.

#### Response `200 OK` — kết quả rỗng hợp lệ (AE-05, AE-07f)

`GET /api/v1/stations?lat=21.2&lng=105.2&service_type=SWAPPING&family_code=FAM_A&radius_km=0.5`

```json
{
  "is_simulated": true,
  "query": {
    "lat": 21.2,
    "lng": 105.2,
    "service_type": "SWAPPING",
    "family_code": "FAM_A",
    "only_open": true,
    "radius_km": 0.5
  },
  "total": 0,
  "stations": []
}
```

#### Response `400` — dữ liệu đầu vào sai (AE-07)

`GET /api/v1/stations?lng=105.8435&service_type=SWAPPING&family_code=FAM_A&radius_km=0` trả về đúng error envelope ở §2.1 (`lat`: `REQUIRED`, `radius_km`: `NOT_POSITIVE`).

### 4.4. Chi tiết trạm — `GET /api/v1/stations/{station_id}`

Dùng cho màn hình chi tiết trạm và nút chỉ đường (1.2.2, 1.2.4). Đáp ứng yêu cầu của AE-02: khi xem chi tiết một trạm không hỗ trợ nhóm pin đã chọn, phải thấy rõ là không tương thích.

#### Parameters

| Tham số | Vị trí | Kiểu | Bắt buộc | Quy tắc |
| --- | --- | --- | --- | --- |
| `station_id` | path | string | Có | Khớp `^[A-Z0-9-]{1,32}$`. Sai định dạng trả `400 INVALID_FORMAT`; đúng định dạng nhưng không tồn tại trả `404 STATION_NOT_FOUND`. |
| `family_code` | query | enum | Không | `FAM_A` \| `FAM_B`. Có thì tính `family_supported`, `booking_eligible` và `ineligibility_reason`. |
| `lat`, `lng` | query | number | Không | Phải đi cùng nhau (thiếu một trong hai trả `MISSING_PAIR`). Có thì tính `distance_km` và `distance_display`. |

#### Response `200 OK` — ST-04 với `FAM_A` từ LOC-01 (AE-02)

`GET /api/v1/stations/ST-04?family_code=FAM_A&lat=21.005&lng=105.8435`

```json
{
  "is_simulated": true,
  "query": { "family_code": "FAM_A", "lat": 21.005, "lng": 105.8435 },
  "station": {
    "station_id": "ST-04",
    "name": "Vinergy Demo Station 04",
    "area_label": "Dong Da demo area",
    "coordinates": { "lat": 21.0118, "lng": 105.8335 },
    "opening_status": "OPEN",
    "services": ["SWAPPING"],
    "supported_families": ["FAM_B"],
    "available_batteries_by_family": { "FAM_B": 5 },
    "available_charging_ports_by_family": {},
    "distance_km": 1.284228856998922,
    "distance_display": "1.3 km",
    "family_supported": false,
    "booking_eligible": false,
    "ineligibility_reason": "UNSUPPORTED_FAMILY"
  }
}
```

Nếu không truyền tham số query nào, `query` có cả ba giá trị là `null`. Khi đó `distance_km`, `distance_display`, `family_supported`, `booking_eligible` và `ineligibility_reason` cũng đều là `null`.

Link chỉ đường do frontend dựng từ `coordinates` theo [AD-08](./architecture.md#5-quyết-định-kiến-trúc-ad).

---

## 5. Hợp đồng LLM Tool (spike 1.3.2, dùng tiếp ở Sprint 3)

Schema máy đọc được nằm ở [tool_schemas.json](./tool_schemas.json).

### 5.1. Nguyên tắc

1. **Allowlist:** chỉ các tool có trong `tool_schemas.json` được thực thi. Tên tool lạ trả lỗi `TOOL_NOT_ALLOWED` cho LLM.
2. **Validate lại:** tool adapter dùng chung validator với HTTP layer (AD-06), dù provider đã kiểm schema hay chưa.
3. **Gọi trực tiếp trong tiến trình:** adapter gọi Station Service, không gọi vòng qua HTTP. Kết quả có cùng cấu trúc với body `200` của REST.
4. **Chỉ đọc ở Sprint 1:** chưa có tool nào thay đổi dữ liệu. Tool đặt pin sẽ được thêm ở Sprint 3, sau khi §6 đã chốt.
5. **Tương thích provider:** `tool_schemas.json` dùng JSON Schema Draft 2020-12 làm chuẩn nội bộ. Lớp adapter của provider chịu trách nhiệm bọc định dạng SDK (ví dụ `functionDeclarations` hoặc `type: "function"`) và lược bỏ từ khóa nếu SDK không hỗ trợ (ví dụ `default`, `exclusiveMinimum`), trong khi validator phía server luôn kiểm tra đủ toàn bộ ràng buộc.

### 5.2. Ngữ cảnh do orchestrator chèn

| Ngữ cảnh | Nguồn | LLM thấy gì |
| --- | --- | --- |
| Người dùng | Phiên phía server | Không thấy; không có tham số `user_id` |
| Vị trí (`lat`, `lng`) | `context.location` từ UI (GPS hoặc người dùng chọn trên bản đồ hay form) | Chỉ thấy `location_available: true` hoặc `false`. Tọa độ **không** được gửi cho provider. |
| `family_code` mặc định | `context.family_code`: nhóm pin đang chọn và hiển thị trên UI | Thấy giá trị này trong ngữ cảnh hệ thống |

**Cách xác định `family_code` và ngữ cảnh thiếu:**
- Với `search_stations`: ưu tiên `family_code` do LLM truyền (chỉ khi người dùng nói rõ trong hội thoại), nếu không có thì lấy `context.family_code`. Giá trị thực tế được lặp lại ở `query.family_code`. Nếu thiếu `context.location` (kể cả khi cũng thiếu `family_code`), trả `LOCATION_REQUIRED` (và ghi thêm `family_code` vào `details` nếu cũng thiếu để LLM hỏi một lần). Nếu chỉ thiếu `family_code`, trả `FAMILY_REQUIRED`.
- Với `get_station_detail`: `family_code` là tùy chọn giống REST §4.4. Dùng tham số LLM truyền hoặc fallback sang `context.family_code`; nếu cả hai đều không có thì bỏ qua (`family_supported`, `booking_eligible`, `ineligibility_reason` trả `null`).

### 5.3. Ánh xạ tool

| Tool | Tham số LLM | Tương đương REST |
| --- | --- | --- |
| `search_stations` | `service_type` (bắt buộc), `family_code`, `only_open`, `radius_km` | `GET /api/v1/stations`, với `lat`/`lng` được chèn |
| `get_station_detail` | `station_id` (bắt buộc), `family_code` | `GET /api/v1/stations/{station_id}`, với `lat`/`lng` được chèn nếu có |

### 5.4. Kết quả tool

Ví dụ thành công (trường hợp rỗng hợp lệ theo AE-05):

```json
{
  "ok": true,
  "data": {
    "is_simulated": true,
    "query": {
      "lat": 21.2,
      "lng": 105.2,
      "service_type": "SWAPPING",
      "family_code": "FAM_A",
      "only_open": true,
      "radius_km": 0.5
    },
    "total": 0,
    "stations": []
  }
}
```

Ví dụ lỗi thiếu ngữ cảnh vị trí và nhóm pin:

```json
{
  "ok": false,
  "error": {
    "code": "LOCATION_REQUIRED",
    "message": "Chưa có vị trí và nhóm pin. Hãy đề nghị người dùng chia sẻ hoặc chọn vị trí cùng nhóm pin trong ứng dụng.",
    "details": [
      { "field": "location", "reason": "REQUIRED", "message": "Chưa có tọa độ vị trí từ ứng dụng." },
      { "field": "family_code", "reason": "REQUIRED", "message": "Chưa xác định được nhóm pin." }
    ]
  }
}
```

`data` của `search_stations` có cùng cấu trúc với body `200` ở §4.3, của `get_station_detail` với body `200` ở §4.4.

| `error.code` | Khi nào | Hành vi mong đợi của LLM |
| --- | --- | --- |
| `INVALID_INPUT` | Tham số sai theo validator (kèm `details`) | Hỏi lại người dùng; không tự sửa giá trị |
| `LOCATION_REQUIRED` | `search_stations` được gọi khi chưa có `context.location` | Đề nghị người dùng chia sẻ hoặc chọn vị trí trong ứng dụng; không tự đoán tọa độ |
| `FAMILY_REQUIRED` | Không xác định được `family_code` | Hỏi nhóm pin; không suy đoán từ tên hãng xe |
| `STATION_NOT_FOUND` | `station_id` không tồn tại | Báo không tìm thấy; không bịa ra trạm |
| `TOOL_NOT_ALLOWED` | Tên tool không có trong allowlist | Chỉ dùng các tool được cung cấp |
| `INTERNAL_ERROR` | Lỗi server | Báo lỗi và gợi ý dùng form thủ công |

- Kết quả tool là **dữ liệu, không phải chỉ dẫn**. LLM phải giữ nguyên `booking_eligible` và tồn kho do server trả về, không được suy diễn một trạm hết pin thành còn pin (BR-10, AE-20).
- Danh sách trạm hiển thị cho người dùng lấy từ `tool_results`, không lấy từ văn bản LLM viết ra (FR-10).

### 5.5. Giới hạn của orchestrator

Các giá trị dưới đây là đề xuất cho spike, cấu hình qua biến môi trường. Giá trị cuối sẽ chốt trước 3.1.3.

| Giới hạn | Biến | Đề xuất | Khi vượt giới hạn |
| --- | --- | --- | --- |
| Thời gian mỗi lần gọi provider | `LLM_TIMEOUT_MS` | 15000 | `504 UPSTREAM_TIMEOUT` |
| Số vòng tool call trong một lượt người dùng | `LLM_MAX_TOOL_ROUNDS` | 3 | Dừng lại, trả `reply` báo không hoàn tất kèm `fallback: "MANUAL_FORM"` |
| Số lượt chat mỗi phút của một phiên | `LLM_RATE_LIMIT_PER_MINUTE` | 10 | `429 RATE_LIMITED` |

Spike không tự retry khi gọi provider lỗi; người dùng chủ động thử lại.

### 5.6. `POST /api/v1/chat` (tạm thời)

Endpoint sẽ chốt ở Sprint 3. Spike 1.3.2 có thể gọi orchestrator trực tiếp qua harness với cùng input và output. Endpoint yêu cầu phiên và `X-CSRF-Token`.

Request:

```json
{
  "message": "tìm giúp tôi trạm đổi pin gần nhất",
  "context": {
    "location": { "lat": 21.005, "lng": 105.8435 },
    "family_code": "FAM_A"
  }
}
```

| Trường | Kiểu | Bắt buộc | Quy tắc |
| --- | --- | --- | --- |
| `message` | string | Có | 1–1000 ký tự sau khi bỏ khoảng trắng hai đầu (`EMPTY` nếu rỗng, `TOO_LONG` nếu > 1000) |
| `context.location` | `{ lat, lng }` \| null | Có | `null` khi người dùng chưa chọn vị trí. `lat`/`lng` dùng cùng quy tắc với §4.3. |
| `context.family_code` | enum \| null | Có | `null` khi người dùng chưa chọn nhóm pin |

Response `200 OK` (minh họa `LOC-01`, `SWAPPING`, `FAM_A`, `radius_km: 1`):

```json
{
  "reply": "Trạm đổi pin FAM_A gần nhất còn pin là Vinergy Demo Station 01 (0.0 km, còn 6 pin).",
  "tool_results": [
    {
      "tool": "search_stations",
      "ok": true,
      "data": {
        "is_simulated": true,
        "query": {
          "lat": 21.005,
          "lng": 105.8435,
          "service_type": "SWAPPING",
          "family_code": "FAM_A",
          "only_open": true,
          "radius_km": 1
        },
        "total": 2,
        "stations": [
          {
            "station_id": "ST-01",
            "name": "Vinergy Demo Station 01",
            "area_label": "Hai Ba Trung demo area",
            "coordinates": { "lat": 21.005, "lng": 105.8435 },
            "opening_status": "OPEN",
            "services": ["CHARGING", "SWAPPING"],
            "supported_families": ["FAM_A", "FAM_B"],
            "available_batteries_by_family": { "FAM_A": 6, "FAM_B": 4 },
            "available_charging_ports_by_family": { "FAM_A": 3, "FAM_B": 2 },
            "distance_km": 0.0,
            "distance_display": "0.0 km",
            "family_supported": true,
            "booking_eligible": true,
            "ineligibility_reason": null
          },
          {
            "station_id": "ST-03",
            "name": "Vinergy Demo Station 03",
            "area_label": "Hai Ba Trung demo area",
            "coordinates": { "lat": 21.0115, "lng": 105.8492 },
            "opening_status": "OPEN",
            "services": ["SWAPPING"],
            "supported_families": ["FAM_A"],
            "available_batteries_by_family": { "FAM_A": 8 },
            "available_charging_ports_by_family": {},
            "distance_km": 0.9340655580626385,
            "distance_display": "0.9 km",
            "family_supported": true,
            "booking_eligible": true,
            "ineligibility_reason": null
          }
        ]
      }
    }
  ],
  "fallback": null
}
```

- `fallback` nhận `null` hoặc `"MANUAL_FORM"` (`200 OK` có thể trả `"fallback": "MANUAL_FORM"` khi vượt `LLM_MAX_TOOL_ROUNDS`).
- Lỗi `429`, `503`, `504` dùng error envelope ở §2.1, thêm trường `"fallback": "MANUAL_FORM"` ở cấp gốc.
- Server không lưu `message`, `reply` hay `context` (xem [architecture.md §7](./architecture.md#7-quyền-riêng-tư--logging-chính-sách-ban-đầu-theo-srs-8)).

---

## 6. Đặt pin (Sprint 2)

> Chốt ở 2.1.3 (draft v2.2, chờ rà soát), đã đối chiếu 2.1.1. Client dựng theo bản tạm rev 2 xem §6.12. Thiết kế trạng thái, giao dịch và lý do: [Reservation_Design.md](../design/Reservation_Design.md). Các giá trị thời gian là cấu hình; ví dụ dùng đề xuất demo của M1 ở SRS §8: `DRAFT_TTL_MINUTES = 5` (tính từ lúc tạo nháp), `RESERVATION_HOLD_MINUTES = 15` (tính từ lúc xác nhận thành công). Một mốc hết hạn có hiệu lực đến ngay trước thời điểm đó (`now >= expires_at` là đã hết hạn).

Mọi endpoint ở mục này:

- Yêu cầu phiên demo (§3). `POST` yêu cầu thêm `X-CSRF-Token`.
- Danh tính **chỉ** lấy từ phiên. Trường `user_id`, `owner`, `demo_user` trong body bị từ chối là `UNKNOWN_FIELD` (§1.3), không bao giờ được dùng để phân quyền (BR-10).
- Đơn hoặc bản nháp của người khác trả `404` như không tồn tại (AE-14).
- Response có `"is_simulated": true` và `Cache-Control: no-store`.
- Thời gian lấy theo đồng hồ server (AD-07). Không có tham số hay header nào cho client đặt thời gian.

### 6.1. Endpoints

| Endpoint | Mục đích | Thành công |
| --- | --- | --- |
| `POST /api/v1/reservation-drafts` | Tạo bản nháp, **không** giữ tồn kho (BR-06) | `201` + `draft` |
| `GET /api/v1/reservation-drafts/{draft_id}` | Đọc lại bản nháp (tải lại trang, chat) | `200` + `draft` |
| `POST /api/v1/reservations` | Xác nhận bản nháp, giữ đúng 1 pin (BR-07, BR-08) | `201` đơn mới, hoặc `200` khi gửi lại cùng khóa |
| `GET /api/v1/reservations` | Danh sách đơn của phiên hiện tại | `200` + `reservations` |
| `GET /api/v1/reservations/{reservation_id}` | Chi tiết một đơn | `200` + `reservation` |
| `POST /api/v1/reservations/{reservation_id}/cancel` | Hủy đơn, hoàn pin đúng một lần | `200` + `reservation` |

`draft_id` và `reservation_id` là UUID dạng chuẩn chữ thường (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`). Sai định dạng trả `400 INVALID_FORMAT`; đúng định dạng nhưng không có (hoặc của người khác) trả `404`.

### 6.2. Quy tắc validate riêng

| Trường | Quy tắc | `reason` khi sai |
| --- | --- | --- |
| `quantity` | Bắt buộc, kiểu JSON `number`, đúng bằng số nguyên `1`. Từ chối `0`, `-1`, `2`, `1.5`, `1.0` (BR-05, AE-08). | Thiếu: `REQUIRED`. Không phải `number` (`"1"`, `true`, `[1]`, `null`): `NOT_A_NUMBER`. Số khác `1`: `MUST_BE_ONE` |
| `family_code` | Bắt buộc, enum `FAM_A` \| `FAM_B` | `REQUIRED`, `NOT_IN_ENUM`, `INVALID_FORMAT` (không phải string) |
| `station_id` | Khớp `^[A-Z0-9-]{1,32}$` | `INVALID_FORMAT` |
| `station_id` / `nearest` (tạo bản nháp) | Có **đúng một** trong hai | Thiếu cả hai: `ONE_OF_REQUIRED` (`field: "station_id"`). Có cả hai: `MUTUALLY_EXCLUSIVE` (`field: "nearest"`) |
| `nearest.lat`, `nearest.lng`, `nearest.radius_km` | Như `lat`, `lng`, `radius_km` của §4.3 nhưng là JSON `number`. `radius_km` tùy chọn. | `field` dùng dạng `nearest.lat`. Trường lạ trong `nearest`: `UNKNOWN_FIELD` |
| Header `Idempotency-Key` (xác nhận) | Bắt buộc, khớp `^[A-Za-z0-9_-]{16,100}$` (UUID v4 là lựa chọn khuyến nghị) | `REQUIRED`, `INVALID_FORMAT` (`field: "Idempotency-Key"`) |
| Body của `cancel` | Không có body, hoặc `{}` | Có trường: `UNKNOWN_FIELD` |

Validator gom toàn bộ lỗi như §1.2. Thứ tự `details`: path, header, sau đó các trường body theo thứ tự trong bảng của endpoint, cuối cùng là trường lạ.

### 6.3. Đối tượng `draft`

| Trường | Kiểu | Ghi chú |
| --- | --- | --- |
| `draft_id` | string (UUID) | |
| `status` | `OPEN` \| `USED` \| `EXPIRED` | Suy ra lúc đọc ([Reservation_Design.md §3.2](../design/Reservation_Design.md#32-bản-nháp)) |
| `station` | object | `station_id`, `name`, `area_label`, `coordinates`, `distance_km`, `distance_display`. Khoảng cách là `null` nếu bản nháp tạo bằng `station_id`. |
| `family_code` | string | |
| `quantity` | integer | Luôn `1` |
| `available_batteries` | integer \| null | Tồn kho **hiện tại** của nhóm tại trạm lúc đọc. Chỉ để hiển thị, **không được giữ**. |
| `hold_minutes` | integer | Thời gian giữ pin nếu xác nhận ngay (`RESERVATION_HOLD_MINUTES`) |
| `created_at`, `expires_at` | string (ISO 8601 UTC) | `expires_at` = hạn **xác nhận** bản nháp |
| `reservation_id` | string \| null | Có giá trị khi `status = USED` |

Đối tượng này chứa đủ nội dung cần hiện trước khi xác nhận (FR-06, 2.1.2): trạm, nhóm pin, số lượng, thời gian giữ, hạn xác nhận.

### 6.4. `POST /api/v1/reservation-drafts`

Body (chọn một trong hai cách chỉ định trạm):

```json
{ "family_code": "FAM_A", "quantity": 1, "station_id": "ST-01" }
```

```json
{ "family_code": "FAM_A", "quantity": 1, "nearest": { "lat": 21.0032, "lng": 105.856, "radius_km": 5 } }
```

| Trường | Kiểu | Bắt buộc |
| --- | --- | --- |
| `family_code` | enum | Có |
| `quantity` | number (= 1) | Có |
| `station_id` | string | Một trong hai |
| `nearest` | `{ lat, lng, radius_km? }` | Một trong hai |

Xử lý:

- `station_id`: trạm phải `booking_eligible = true` cho `family_code` lúc tạo (§4.2). Nếu không, trả `409 STATION_NOT_ELIGIBLE` với `details[0] = { "field": "station_id", "reason": <ineligibility_reason> }` (AE-03: ST-02 → `CHARGING_ONLY`). Trạm không tồn tại trả `404 STATION_NOT_FOUND`.
- `nearest`: chạy tìm kiếm §4.3 với `service_type = SWAPPING`, `only_open = true` và `radius_km` nếu có, rồi chọn trạm **đầu tiên có `booking_eligible = true`**. Không mở rộng bán kính. Không có ứng viên trả `409 NO_ELIGIBLE_STATION` (AE-18).
- Không thay đổi tồn kho (AE-09).

Response `201 Created` — AE-18, vị trí trùng ST-05, lúc `2026-11-25T08:00:00Z`:

```json
{
  "is_simulated": true,
  "draft": {
    "draft_id": "5f0c2a1e-7b3d-4c6e-9a10-2b4d6f8a0c11",
    "status": "OPEN",
    "station": {
      "station_id": "ST-03",
      "name": "Vinergy Demo Station 03",
      "area_label": "Hai Ba Trung demo area",
      "coordinates": { "lat": 21.0115, "lng": 105.8492 },
      "distance_km": 1.1619073809919698,
      "distance_display": "1.2 km"
    },
    "family_code": "FAM_A",
    "quantity": 1,
    "available_batteries": 8,
    "hold_minutes": 15,
    "created_at": "2026-11-25T08:00:00Z",
    "expires_at": "2026-11-25T08:05:00Z",
    "reservation_id": null
  }
}
```

ST-05 đứng đầu tìm kiếm ở 0.0 km nhưng hết pin A, nên không được chọn.

### 6.5. `GET /api/v1/reservation-drafts/{draft_id}`

Trả `200` với cùng cấu trúc §6.4, `status` và `available_batteries` tính lại lúc đọc. Không có, hoặc của người khác: `404 DRAFT_NOT_FOUND`.

### 6.6. Đối tượng `reservation`

| Trường | Kiểu | Ghi chú |
| --- | --- | --- |
| `reservation_id` | string (UUID) | |
| `status` | `ACTIVE` \| `CANCELLED` \| `EXPIRED` | Đã đối soát hết hạn trước khi trả (BR-09) |
| `draft_id` | string (UUID) | |
| `station` | object | `station_id`, `name`, `area_label`, `coordinates` |
| `family_code` | string | |
| `quantity` | integer | Luôn `1` |
| `created_at` | string | Thời điểm xác nhận |
| `expires_at` | string | Hết thời gian giữ pin |
| `cancelled_at`, `expired_at` | string \| null | Đúng một trường có giá trị khi đơn đã kết thúc |

### 6.7. `POST /api/v1/reservations`

Header `Idempotency-Key: 8b2f6c1a-3d4e-4f5a-9b6c-7d8e9f0a1b2c`. Body lặp lại nội dung của bản nháp người dùng đã thấy:

```json
{ "draft_id": "9a7e3c52-1f4b-4d8a-b6c2-0e5f7a9b1d34", "station_id": "ST-01", "family_code": "FAM_A", "quantity": 1 }
```

Thứ tự xử lý (sau §1.3 bước 1–5):

1. Khóa đã gắn với đơn và body giống hệt → **gửi lại**: trả đơn gốc ở trạng thái hiện tại, `200 OK`, header `Idempotent-Replayed: true`. Không kiểm tra hạn bản nháp, trạm hay tồn kho; không giữ thêm pin (BR-08, AE-11).
2. Khóa đã gắn với đơn nhưng body khác → `409 IDEMPOTENCY_KEY_REUSED` (AE-12).
3. Bản nháp không có hoặc của người khác → `404 DRAFT_NOT_FOUND`.
4. Bản nháp đã tạo đơn (với khóa khác) → `409 DRAFT_ALREADY_USED` (AE-17).
5. Body lệch `station_id`/`family_code`/`quantity` của bản nháp → `409 DRAFT_STALE`, `reason: CONTENT_MISMATCH`.
6. Bản nháp hết hạn → `409 DRAFT_STALE`, `reason: DRAFT_EXPIRED`.
7. Trạm không `OPEN` hoặc hết pin → `409 STATION_NOT_ELIGIBLE` với `reason` `STATION_CLOSED` \| `STATION_MAINTENANCE` \| `OUT_OF_STOCK` (AE-10, AE-13).
8. Còn lại: trừ 1 pin, tạo đơn `ACTIVE`, `201 Created`, header `Location: /api/v1/reservations/{reservation_id}`.

Yêu cầu bị từ chối không lưu gì: có thể thử lại cùng khóa sau khi sửa nguyên nhân. Nếu một yêu cầu cùng khóa đang xử lý quá `IDEMPOTENCY_LOCK_TIMEOUT_MS`, trả `409 REQUEST_IN_PROGRESS` kèm `Retry-After: 1`; client gửi lại **cùng khóa, cùng body**.

Response `201 Created` — AE-10/AE-10b, nháp tạo lúc `08:00:00Z`, xác nhận lúc `2026-11-25T08:04:00Z` (trước hạn nháp 08:05), tồn kho ST-01/FAM_A từ 6 còn 5, giữ đến 08:19:

```json
{
  "is_simulated": true,
  "reservation": {
    "reservation_id": "3c9d1e7a-2b5f-4a8c-9d0e-1f2a3b4c5d6e",
    "status": "ACTIVE",
    "draft_id": "9a7e3c52-1f4b-4d8a-b6c2-0e5f7a9b1d34",
    "station": {
      "station_id": "ST-01",
      "name": "Vinergy Demo Station 01",
      "area_label": "Hai Ba Trung demo area",
      "coordinates": { "lat": 21.005, "lng": 105.8435 }
    },
    "family_code": "FAM_A",
    "quantity": 1,
    "created_at": "2026-11-25T08:04:00Z",
    "expires_at": "2026-11-25T08:19:00Z",
    "cancelled_at": null,
    "expired_at": null
  }
}
```

Response `409` — AE-13, người thứ hai tranh viên pin cuối:

```json
{
  "error": {
    "code": "STATION_NOT_ELIGIBLE",
    "message": "Trạm không còn đủ điều kiện đặt pin.",
    "details": [ { "field": "station_id", "reason": "OUT_OF_STOCK", "message": "Trạm đã hết pin FAM_A khả dụng." } ]
  },
  "request_id": "req_01JD7K2M3N4P5Q6R7S8T9V0W1X"
}
```

### 6.8. `GET /api/v1/reservations`

Query tùy chọn `status` (`ACTIVE` \| `CANCELLED` \| `EXPIRED`), theo quy tắc §1.2. Đối soát mọi đơn `ACTIVE` quá hạn **của người dùng** trước khi đọc. Sắp xếp `created_at` giảm dần, rồi `reservation_id` tăng dần. Không phân trang.

```json
{ "is_simulated": true, "query": { "status": null }, "total": 1, "reservations": [ { "reservation_id": "…", "status": "ACTIVE" } ] }
```

(Mỗi phần tử là đối tượng §6.6 đầy đủ; rút gọn ở đây.)

### 6.9. `GET /api/v1/reservations/{reservation_id}`

`200` với `{ "is_simulated": true, "reservation": { … } }`, sau khi đối soát hết hạn. Không có, hoặc của người khác: `404 RESERVATION_NOT_FOUND`.

### 6.10. `POST /api/v1/reservations/{reservation_id}/cancel`

Không có body (hoặc `{}`). Luôn `200` với đơn ở trạng thái sau thao tác:

| Trạng thái trước | Thời điểm | Kết quả | Tồn kho |
| --- | --- | --- | --- |
| `ACTIVE` | `now < expires_at` | `CANCELLED` (AE-15, AE-16a) | +1 |
| `ACTIVE` | `now >= expires_at` | `EXPIRED`, không phải lỗi (AE-16b) | +1 |
| `CANCELLED` / `EXPIRED` | bất kỳ | Giữ nguyên trạng thái | Không đổi |

Hủy lặp lại không bao giờ hoàn pin lần hai (AE-15, AE-16d). Không có hoặc của người khác: `404 RESERVATION_NOT_FOUND`, không đổi tồn kho (AE-14).

### 6.11. Mã lỗi đặt pin

Bổ sung vào bảng §2.2. Mỗi mã gắn một HTTP status.

| HTTP | `error.code` | Khi nào | AE |
| --- | --- | --- | --- |
| `400` | `INVALID_INPUT` | Gồm `quantity` khác số nguyên `1`, thiếu/sai `Idempotency-Key` | AE-08 |
| `404` | `DRAFT_NOT_FOUND` | Bản nháp không tồn tại hoặc thuộc người khác | AE-14, AE-17 |
| `404` | `RESERVATION_NOT_FOUND` | Đơn không tồn tại hoặc thuộc người khác | AE-14 |
| `409` | `IDEMPOTENCY_KEY_REUSED` | Cùng khóa, khác body | AE-12 |
| `409` | `REQUEST_IN_PROGRESS` | Yêu cầu cùng khóa đang xử lý quá thời gian chờ; kèm `Retry-After` | AE-11 |
| `409` | `DRAFT_ALREADY_USED` | Bản nháp đã tạo đơn, gửi kèm khóa khác | AE-17 |
| `409` | `DRAFT_STALE` | Bản nháp hết hạn (`DRAFT_EXPIRED`) hoặc body lệch nội dung bản nháp (`CONTENT_MISMATCH`) | AE-17 |
| `409` | `STATION_NOT_ELIGIBLE` | Trạm không đủ điều kiện lúc tạo bản nháp hoặc xác nhận; `details[0].reason` là một `ineligibility_reason` | AE-03, AE-10, AE-13 |
| `409` | `NO_ELIGIBLE_STATION` | `nearest` không có trạm đủ điều kiện trong phạm vi | AE-18 |
| `409` | `ACTIVE_RESERVATION_LIMIT` | **Dự phòng.** Đề xuất 2.1.1 cho phép nhiều đơn `ACTIVE` (AE-11a), nên mã này không dùng trừ khi nhóm đổi chính sách | — |

### 6.12. Thay đổi phía client so với bản tạm rev 2

Bản tạm rev 2 chỉ giữ chỗ tên endpoint và mã lỗi, chưa định nghĩa phản hồi. Prototype 2.1.2 (`prototypes/reservation-flow/`) dựng theo bản đó, nên khi nối API thật phải đổi các điểm dưới đây. Hai dòng đầu làm sai kết quả xác nhận hoặc thông tin người dùng thấy trước khi đặt, nên cần sửa trước.

| # | Chỗ | Bản tạm rev 2 / prototype | Hợp đồng v2.1 |
| --- | --- | --- | --- |
| 1 | Body `POST /reservations` | `{ draft_id, draft_revision, quantity }` | `{ draft_id, station_id, family_code, quantity }`, lấy từ `draft.station.station_id` và `draft.family_code` của bản nháp người dùng đang xem. Gửi `draft_revision` nhận `400 UNKNOWN_FIELD`; thiếu `station_id`/`family_code` nhận `400 REQUIRED`. |
| 2 | Gửi lại sau khi mất phản hồi | Dựng lại body từ trạng thái màn hình | Gửi **đúng body đã gửi lần đầu** cùng `Idempotency-Key`. Client lưu body cùng với khóa. Server so `request_hash` trên cả 4 trường (thứ tự khóa JSON không quan trọng); lệch bất kỳ trường nào nhận `409 IDEMPOTENCY_KEY_REUSED` thay vì đơn gốc. |
| 3 | Thời gian giữ hiển thị trước khi xác nhận (FR-06) | `hold_ttl_seconds` ở ngoài `draft`; thiếu thì hiện 15 phút | `draft.hold_minutes` (đơn vị phút, nằm trong `draft`). Không có giá trị mặc định phía client. Kiểm tra với cấu hình khác 15 phút để chắc màn hình đọc từ server. |
| 4 | Thông tin trạm | `station_id`, `station_name`, `area_label`, `coordinates` phẳng trong `draft`/`reservation` | Lồng trong `draft.station` (§6.3) và `reservation.station` (§6.6). Tên trạm là `station.name`. |
| 5 | Tồn kho hiển thị | `draft.available_batteries_snapshot` | `draft.available_batteries`, tính lại mỗi lần đọc, không được giữ |
| 6 | Trường không có trong hợp đồng | `draft_revision`, `user_id`, `opening_status`, `used_by_reservation_id` trong `draft`; `user_id` trong `reservation` | Dùng `draft.status` và `draft.reservation_id`. Chủ đơn luôn là người dùng của phiên hiện tại, nên không trả `user_id`. |
| 7 | Body `POST /reservation-drafts` | Kèm `origin` khi chọn trạm bằng `station_id` | Không có `origin`; gửi lên nhận `400 UNKNOWN_FIELD`. Khoảng cách chỉ có khi dùng `nearest`; với `station_id`, `distance_km` là `null`. |
| 8 | Phản hồi hủy | Có thêm `released_stock`, `reconciled_from_expiry` | Chỉ có `reservation`. Kết quả đọc từ `reservation.status`: `CANCELLED` là đã hủy và hoàn pin, `EXPIRED` là đơn đã hết hạn trước khi hủy (§6.10). |
| 9 | `409 REQUEST_IN_PROGRESS` | `retry_after_seconds` trong body | Header `Retry-After` (giây) |
| 10 | `409 DRAFT_STALE` | Không phân biệt nguyên nhân | `details[0].reason` là `DRAFT_EXPIRED` hoặc `CONTENT_MISMATCH` |
| 11 | Mã định danh | `drf_…`, `res_…` | UUID chữ thường (§6.1). Ô tra cứu đơn nhập sai định dạng nhận `400 INVALID_FORMAT`, không phải `404`. |
| 12 | `reason` khi validate | `INVALID_FORMAT`, `OUT_OF_RANGE` | `station_id`/`nearest`: `ONE_OF_REQUIRED`, `MUTUALLY_EXCLUSIVE`. `quantity`: `NOT_A_NUMBER`, `MUST_BE_ONE` (§6.2) |
| 13 | Đồng hồ server cho đếm ngược | `server_time` trong body | **Chưa có trong hợp đồng.** M3 và M4 cần chốt trước 2.2: thêm `server_time` vào mọi phản hồi §6, hoặc client đọc header `Date`. |

Các thay đổi khác so với rev 2: bản nháp bất biến nên không còn `draft_revision` (mỗi `draft_id` là một phiên bản); thêm `GET /reservation-drafts/{draft_id}`.

---

## 7. Truy vết ví dụ nghiệm thu → hợp đồng

| AE | Mục trong tài liệu này |
| --- | --- |
| AE-01 | §1.1, §4.2, §4.3 (ví dụ response) |
| AE-02 | §4.2, §4.4 (ví dụ ST-04) |
| AE-03 | §4.2 (ST-02 `CHARGING_ONLY`), §4.3 điều kiện lọc |
| AE-05, AE-07f | §2.1, §2.3 quy tắc phía client, §4.3 (ví dụ kết quả rỗng) |
| AE-07a…e | §1.2, §2.3, §4.3 |
| AE-08 | §6.2 (`MUST_BE_ONE`) |
| AE-09, AE-09a | §6.3 (`expires_at`, `hold_minutes`), §6.4 (không trừ tồn kho), §6.7 bước 6 |
| AE-10, AE-10a, AE-13 | §6.4 (`STATION_NOT_ELIGIBLE` lúc tạo nháp), §6.7 bước 7–8, ví dụ `409 OUT_OF_STOCK` |
| AE-10b | §6.6, ví dụ `201` của §6.7, §6.9 |
| AE-11, AE-11a, AE-12 | §6.7 bước 1–2, `REQUEST_IN_PROGRESS`, §6.11 `ACTIVE_RESERVATION_LIMIT` (không dùng) |
| AE-15, AE-16 | §6.10 |
| AE-17 | §6.7 bước 3–6 |
| AE-14, AE-23f | §3.4, §5.2, §6 (đầu mục), §6.5, §6.9, §6.10 |
| AE-18 | §6.4 (`nearest`, ví dụ ST-03), §6.11 `NO_ELIGIBLE_STATION` |
| AE-19 | §4.2 (eligibility không phụ thuộc `service_type`), §5.2 |
| AE-20 | §5.1, §5.4 |
| AE-21 | §2.2 (`503`/`504`), §5.5, §5.6 `fallback` |

---

## 8. Lịch sử thay đổi

| Bản | Ngày | Nội dung |
| --- | --- | --- |
| rev 1 | — | Bản nháp đầu tiên |
| rev 2 | 2026-11-13 | Sửa ví dụ search theo AE-01. Mỗi mã lỗi gắn một HTTP status, bổ sung thứ tự middleware và quy tắc body JSON. Thêm quy tắc parse query và mã `reason`. Thêm hợp đồng phiên demo và CSRF. Định nghĩa đối tượng `Station` và thuật toán eligibility có thứ tự, kèm bảng đối chiếu. Thêm `family_code`, `lat`, `lng` cho endpoint chi tiết. Đồng bộ `tool_schemas.json` v1.0 (bỏ `lat`/`lng`, thêm `result_schemas`), ngữ cảnh chèn, kết quả/lỗi tool, giới hạn orchestrator và `/chat` tạm thời khớp schema. Giữ chỗ mã lỗi Sprint 2. |
| v2.0 draft | 2026-11-23 | (2.1.3, M4) Thay §6 tạm thời bằng hợp đồng đặt pin đầy đủ: đối tượng `draft`/`reservation`, 6 endpoint, quy tắc validate `quantity`/`Idempotency-Key`/`nearest`, thứ tự xử lý xác nhận và gửi lại, bảng hủy theo thời điểm, mã lỗi §6.11. Bỏ `draft_revision` (bản nháp bất biến), body xác nhận lặp lại `station_id`/`family_code`, thêm `GET /reservation-drafts/{draft_id}`, thêm `reason` mới vào §2.3. |
| v2.1 draft | 2026-11-24 | (2.1.3, M4) Đối chiếu 2.1.1: ví dụ dùng hạn nháp 5 phút và giữ pin 15 phút (AE-09a, AE-10b); `ACTIVE_RESERVATION_LIMIT` ghi rõ không dùng theo đề xuất cho phép nhiều đơn (AE-11a); bổ sung truy vết AE-09a/10a/10b/11a. §3.4: thống nhất với §1.3 — `user_id`/`owner` trong body/query bị từ chối là trường lạ, không còn ghi "bị bỏ qua". |
| v2.2 draft | 2026-11-25 | (2.1.3, M4) Theo góp ý review: thêm §6.12, liệt kê từng thay đổi client 2.1.2 cần làm so với bản tạm rev 2 (body xác nhận, gửi lại, `draft.hold_minutes`, cấu trúc lồng `station`, phản hồi hủy). Ghi nhận `server_time` là điểm chưa chốt. |
