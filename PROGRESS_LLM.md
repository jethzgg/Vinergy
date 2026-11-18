# Vinergy — Nhật ký tiến độ công việc: LLM Tool Calling Spike (1.3.2)

> **Nhánh Git:** `feat/1.3.2-llm-tool-spike`  
> **Người thực hiện:** M6 — Nguyễn Đăng Dương  
> **Thời gian:** 18/11/2026 (Tuần 10 — Sprint 1)  
> **Nhiệm vụ:** [WBS 1.3.2] Spike LLM tool calling and service access (3 Story Points)

---

## Danh mục công việc đã thực hiện

### 1. Khảo sát & Chuẩn bị môi trường
- [x] Tạo và chuyển sang nhánh `feat/1.3.2-llm-tool-spike` dựa trên skeleton của task 1.3.1.
- [x] Rà soát các tài liệu kiến trúc và yêu cầu nghiệp vụ:
  - `docs/architecture/tool_schemas.json` (Contract chuẩn JSON Schema Draft 2020-12 cho `search_stations` & `get_station_detail`).
  - `docs/architecture/api_contracts.md` (§1.1 Haversine, §4.2 Thuật toán điều kiện đặt pin, §5 Hợp đồng LLM Tool).
  - `docs/requirements/SRS.md` (`FR-05`, `BR-10`, `AE-20`, `AE-21`, `NFR-03`, `NFR-06`, `NFR-08`).
  - `data/seed_stations_v0.json` (Bộ dữ liệu mẫu 18 trạm tại Hà Nội).
- [x] Cập nhật `backend/requirements.txt`: Bổ sung `pydantic-settings`, `google-genai`, `pytest-asyncio`, `pytest-cov`, và cấu hình môi trường ảo `.venv`.

---

### 2. Xây dựng các mô-đun mã nguồn (Backend)

| STT | Mô-đun | Đường dẫn tệp | Chức năng chi tiết |
| :-: | :--- | :--- | :--- |
| 1 | **Core Config** | `backend/app/core/config.py` | Nạp cấu hình từ biến môi trường/`.env`, tự động che dấu bí mật (`llm_api_key`) khi in log (`NFR-03`, `AE-23a`). |
| 2 | **Schema Loader** | `backend/app/llm/schemas.py` | Đọc và nạp schema từ `tool_schemas.json`, lưu vào bộ đệm bộ nhớ và cung cấp thông tin kiểm tra allowlist. |
| 3 | **Station Stub Service** | `backend/app/services/station_stub.py` | Cài đặt công thức khoảng cách Haversine chuẩn ($R=6371\text{ km}$), lọc danh sách theo `service_type`, `family_code`, `only_open`, `radius_km`, sắp xếp khoảng cách và tính toán `booking_eligible` theo đúng thứ tự ưu tiên của SRS §4.2. |
| 4 | **Tool Adapter** | `backend/app/llm/tool_adapter.py` | Kiểm tra allowlist, kiểm tra tính hợp lệ của tham số (`INVALID_INPUT`), tiêm ngữ cảnh an toàn (`context.location`, `context.family_code`), trả về mã lỗi `LOCATION_REQUIRED` hoặc `FAMILY_REQUIRED` khi thiếu dữ liệu (`BR-10`, `AE-20`). |
| 5 | **Provider Interface** | `backend/app/llm/providers/base.py` | Định nghĩa giao diện trừu tượng `BaseLLMProvider` và đối tượng chuẩn hóa `LLMResponse`, `ToolCall`. |
| 6 | **Mock Provider** | `backend/app/llm/providers/mock_provider.py` | Bộ giả lập phản hồi và gọi tool xác định 100%, phục vụ chạy kiểm thử CI/CD độc lập không tốn chi phí API. |
| 7 | **Google GenAI Provider**| `backend/app/llm/providers/google_genai.py` | Adapter kết nối trực tiếp với SDK `google-genai` (Gemini), hỗ trợ lọc bỏ từ khóa schema không tương thích của SDK và dịch ngược Function Call. |
| 8 | **Orchestrator** | `backend/app/llm/orchestrator.py` | Vòng lặp điều phối hội thoại (User $\to$ LLM $\to$ Tool Adapter $\to$ LLM), khống chế số vòng tối đa `LLM_MAX_TOOL_ROUNDS=3`, đo đạc chi tiết thời gian thực thi từng chặng ($T_{\text{llm}}, T_{\text{tool}}, T_{\text{total}}$), tự động kích hoạt `fallback: "MANUAL_FORM"` khi xảy ra sự cố (`AE-21`). |
| 9 | **Spike Router API** | `backend/app/llm/spike_router.py` | Cung cấp endpoint thử nghiệm `POST /api/v1/spike/llm-chat` kết nối với FastAPI `main.py`. |
| 10 | **CLI Runner** | `scripts/run_llm_spike.py` | Script dòng lệnh tương tác trực tiếp bằng tiếng Việt, hỗ trợ thay đổi tọa độ và nhóm pin theo thời gian thực. |
| 11 | **Benchmark Script** | `scripts/benchmark_latency.py` | Kịch bản đo lường hiệu năng tự động qua 30 chu kỳ, tính toán min, max, median, p95 theo yêu cầu `NFR-06` và `EN-105`. |

---

### 3. Kiểm thử tự động & Bằng chứng xác minh

- **Tệp kiểm thử:**
  - `backend/tests/test_llm_spike.py` (39 test cases kiểm thử đơn vị & tích hợp)
  - `backend/tests/test_llm_helpers.py` (2 test cases kiểm thử phụ trợ & bộ lọc schema)
  - `backend/tests/test_health.py` (2 test cases kiểm tra trạng thái khung ứng dụng)
- **Kết quả thực thi:**
  - **43/43 tests PASS** (100% tỷ lệ đạt)
  - **Độ bao phủ mã nguồn (Coverage):** **83%** trên toàn bộ `app` (vượt ngưỡng yêu cầu $\ge 80\%$ tại `NFR-08`).
  - Các tệp lõi của bài toán đạt độ bao phủ rất cao:
    - `station_stub.py`: **99%**
    - `schemas.py`: **100%**
    - `config.py`: **100%**
    - `orchestrator.py`: **94%**
    - `tool_adapter.py`: **94%**

---

### 4. Bàn giao tài liệu & Báo cáo kỹ thuật
- [x] Tạo tài liệu báo cáo kỹ thuật hoàn chỉnh: `docs/spikes/LLM_Spike_Report.md` với đầy đủ:
  - Phân tích độ trễ và số đo bách phân vị ($T_{\text{tool}}, T_{\text{llm}}$).
  - Bằng chứng đối chiếu các trường hợp nghiệm thu (`AE-20`, `AE-21`, `FR-05`).
  - Khuyến nghị kiến trúc và kỹ thuật tích hợp chuyển giao cho M1 (task 1.3.4) và làm tiền đề cho Sprint 3 (task 3.1.3).

---

### 5. Cập nhật sửa lỗi theo phản hồi (Review Feedback Fixes)

| Phản hồi lỗi | Nguyên nhân gốc rễ | Giải pháp đã triển khai | Kiểm thử xác minh |
| :--- | :--- | :--- | :--- |
| **[P1] Rò rỉ tọa độ người dùng trong lịch sử gửi LLM** | `orchestrator.py` gửi nguyên `tool_result` vào `messages` (chứa `data.query.lat/lng`). | Bổ sung hàm `sanitize_tool_result_for_llm` tự động loại bỏ `lat`/`lng` khỏi `data.query` khi đưa vào hội thoại của LLM, nhưng vẫn giữ nguyên dữ liệu đầy đủ cho ứng dụng (`AD-05`, `NFR-04`). | `test_user_coordinates_stripped_from_llm_history` |
| **[P2] Timeout cấu hình không có hiệu lực** | `google_genai.py` lưu `timeout_ms` nhưng không truyền vào `types.HttpOptions` và `GenerateContentConfig`. | Cấu hình `types.HttpOptions(timeout=timeout_ms)` vào cả `genai.Client` và `GenerateContentConfig`, đồng thời bắt `TIMEOUT` để kích hoạt `fallback: "MANUAL_FORM"`. | `test_google_genai_provider_timeout_config`, `test_orchestrator_handles_timeout_finish_reason` |
| **[P2] Tham số sai kiểu gây lỗi 500 / TypeError** | `tool_adapter.py` kiểm tra `in set` trước khi kiểm tra kiểu dữ liệu (gây `TypeError` với `list`/`dict`), và chấp nhận `radius_km=True`. | Kiểm tra kiểu dữ liệu chuỗi `str` nghiêm ngặt trước khi kiểm tra `in enum`; kiểm tra `not isinstance(rk, bool)` và `math.isfinite(rk)` đối với số thực; kiểm tra định dạng `station_id` bằng Regex. | `test_unhashable_service_type_list`, `test_unhashable_family_code_dict`, `test_radius_km_boolean_rejected`, `test_radius_km_inf_and_nan_rejected`, `test_tool_args_not_a_dict` |
| **[P2] Endpoint LLM chưa thực thi Rate Limit** | `spike_router.py` gọi thẳng orchestrator mà không giới hạn số lượt request/phút. | Cài đặt `InMemoryRateLimiter` theo thuật toán cửa sổ trượt (sliding window) giới hạn `LLM_RATE_LIMIT_PER_MINUTE=10`. Trả về HTTP `429 Too Many Requests` kèm header `Retry-After` và error envelope `RATE_LIMITED`. | `test_rate_limiter_enforcement` |
| **[P2] Lỗi import và thiếu thư viện trong scripts** | `run_llm_spike.py` import sai đường dẫn `app`; `benchmark_latency.py` phụ thuộc `numpy` chưa có trong `requirements.txt`. | Chuẩn hóa `sys.path` trỏ trực tiếp vào thư mục `backend/`; viết lại thuật toán tính median và p95 trong `benchmark_latency.py` bằng thư viện chuẩn `statistics`/`math` (không bắt buộc cài `numpy`); bổ sung `numpy` và `pytest-cov` vào `backend/requirements.txt`. | Chạy trực tiếp `scripts/run_llm_spike.py` và `scripts/benchmark_latency.py` thành công. |

---

## Hướng dẫn tự kiểm thử (Self-Testing Instructions)

Người dùng có thể tự chạy kiểm thử các lỗi trên theo các lệnh sau:

```bash
# 1. Kích hoạt môi trường ảo
source .venv/bin/activate

# 2. Chạy toàn bộ 53 bài test kiểm thử tự động (kèm đo coverage)
cd backend && python -m pytest -v tests/test_spike_fixes.py
python -m pytest --cov=app --cov-branch tests/

# 3. Thử nghiệm chạy CLI tương tác (gõ câu hỏi, 'set location', hoặc 'exit')
cd ..
python scripts/run_llm_spike.py

# 4. Thử nghiệm chạy script đo độ trễ tự động 30 lượt (NFR-06)
python scripts/benchmark_latency.py
```
