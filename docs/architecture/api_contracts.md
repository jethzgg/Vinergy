# Vinergy — Hợp đồng API & LLM Tool (v1.0 — Sprint 1)

> **Trạng thái:** Draft v1.0 — rev 2 (Sprint 1, Task 1.1.2) | **Phụ trách:** M2 (Vu Duy Quang), rà soát cùng M4, M6  
> **Tham chiếu:** [architecture.md](./architecture.md), [tool_schemas.json](./tool_schemas.json), [SRS.md](../requirements/SRS.md), [Acceptance_Examples_and_Sample_Data.md](../requirements/Acceptance_Examples_and_Sample_Data.md), [seed_stations_v0.json](../../data/seed_stations_v0.json)  
> **Phạm vi:** Chốt hợp đồng cho Sprint 1 (§1–§5). §6 là định hướng tạm thời cho Sprint 2 và sẽ chốt ở task 2.1.3. Mọi ví dụ trong tài liệu được tính từ dữ liệu seed và khớp với giá trị đối chiếu của AE.

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

Mã lỗi dành cho Sprint 2 được giữ chỗ ở §6.2.

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
- Mọi `user_id`, `owner` hay `demo_user` xuất hiện trong body, query hoặc tham số tool đều bị bỏ qua và **không bao giờ** được dùng để phân quyền (BR-10, AE-14).
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

## 6. Định hướng Sprint 2 (tạm thời, chốt ở 2.1.3)

Mục này giữ chỗ tên endpoint và mã lỗi để v1 không phải thay đổi phá vỡ tương thích. Mọi endpoint ở đây yêu cầu phiên và `X-CSRF-Token` cho các thao tác ghi.

### 6.1. Endpoints

| Endpoint | Mục đích | Ghi chú |
| --- | --- | --- |
| `POST /api/v1/reservation-drafts` | Tạo bản nháp, **không** giữ tồn kho (BR-06) | Body có `family_code`, `quantity` (phải là số nguyên `1`, BR-05) và một trong hai: `station_id`, hoặc `nearest: { lat, lng, radius_km? }` để server chọn trạm gần nhất đủ điều kiện (AE-18). Trả `draft_id`, `draft_revision`, `expires_at`. |
| `POST /api/v1/reservations` | Xác nhận bản nháp | Body `{ draft_id, draft_revision, quantity }` (với `quantity` là số nguyên `1`, BR-05/BR-06), header `Idempotency-Key`. Tạo mới trả `201`. Gửi lại cùng khóa và cùng nội dung trả `200` với chính đơn gốc, kèm header `Idempotent-Replayed: true` (BR-08, AE-11). Baseline chưa giới hạn mỗi người chỉ có một đơn `ACTIVE`. |
| `GET /api/v1/reservations` | Danh sách đơn của phiên hiện tại | Đối soát đơn quá hạn trước khi trả (BR-09) |
| `GET /api/v1/reservations/{reservation_id}` | Chi tiết một đơn | Đơn của người khác trả `404` (AE-14) |
| `POST /api/v1/reservations/{reservation_id}/cancel` | Hủy đơn `ACTIVE`, hoàn pin đúng một lần | Hủy tại hoặc sau `expires_at` trả `200` với `status: "EXPIRED"`, không trả lỗi (BR-09, AE-16b). Hủy lặp lại trả trạng thái kết thúc hiện tại. |

### 6.2. Mã lỗi giữ chỗ

| HTTP | `error.code` | Khi nào |
| --- | --- | --- |
| `400` | `INVALID_INPUT` | Gồm cả `quantity` khác số nguyên `1` (AE-08) |
| `404` | `DRAFT_NOT_FOUND` | Bản nháp không tồn tại hoặc thuộc người khác |
| `404` | `RESERVATION_NOT_FOUND` | Đơn không tồn tại hoặc thuộc người khác |
| `409` | `IDEMPOTENCY_KEY_REUSED` | Cùng khóa nhưng khác nội dung request (AE-12) |
| `409` | `REQUEST_IN_PROGRESS` | Request cùng khóa đang được xử lý; kèm `Retry-After` (AE-11) |
| `409` | `DRAFT_ALREADY_USED` | Bản nháp đã tạo đơn, gửi kèm khóa mới (AE-17) |
| `409` | `DRAFT_STALE` | Bản nháp hết hạn hoặc `draft_revision` không khớp (AE-17) |
| `409` | `STATION_NOT_ELIGIBLE` | Trạm không còn đủ điều kiện lúc xác nhận; `details[0].reason` là một giá trị `ineligibility_reason` (AE-10, AE-13) |
| `409` | `NO_ELIGIBLE_STATION` | Yêu cầu "gần nhất" không có ứng viên trong phạm vi (AE-18) |

---

## 7. Truy vết ví dụ nghiệm thu → hợp đồng

| AE | Mục trong tài liệu này |
| --- | --- |
| AE-01 | §1.1, §4.2, §4.3 (ví dụ response) |
| AE-02 | §4.2, §4.4 (ví dụ ST-04) |
| AE-03 | §4.2 (ST-02 `CHARGING_ONLY`), §4.3 điều kiện lọc |
| AE-05, AE-07f | §2.1, §2.3 quy tắc phía client, §4.3 (ví dụ kết quả rỗng) |
| AE-07a…e | §1.2, §2.3, §4.3 |
| AE-08…AE-17 | §6 (Sprint 2) |
| AE-14, AE-23f | §3.4, §5.2, §6.1 |
| AE-18 | §6.1 (`nearest`), §6.2 `NO_ELIGIBLE_STATION` |
| AE-19 | §4.2 (eligibility không phụ thuộc `service_type`), §5.2 |
| AE-20 | §5.1, §5.4 |
| AE-21 | §2.2 (`503`/`504`), §5.5, §5.6 `fallback` |

---

## 8. Lịch sử thay đổi

| Bản | Ngày | Nội dung |
| --- | --- | --- |
| rev 1 | — | Bản nháp đầu tiên |
| rev 2 | 2026-11-13 | Sửa ví dụ search theo AE-01. Mỗi mã lỗi gắn một HTTP status, bổ sung thứ tự middleware và quy tắc body JSON. Thêm quy tắc parse query và mã `reason`. Thêm hợp đồng phiên demo và CSRF. Định nghĩa đối tượng `Station` và thuật toán eligibility có thứ tự, kèm bảng đối chiếu. Thêm `family_code`, `lat`, `lng` cho endpoint chi tiết. Đồng bộ `tool_schemas.json` v1.0 (bỏ `lat`/`lng`, thêm `result_schemas`), ngữ cảnh chèn, kết quả/lỗi tool, giới hạn orchestrator và `/chat` tạm thời khớp schema. Giữ chỗ mã lỗi Sprint 2. |
