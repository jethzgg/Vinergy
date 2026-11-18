# Vinergy — Báo cáo thử nghiệm kỹ thuật LLM Tool Calling (Spike 1.3.2)

> **Mã công việc:** WBS 1.3.2 — Spike LLM tool calling and service access  
> **Người thực hiện:** M6 — Nguyễn Đăng Dương  
> **Thời gian:** Sprint 1 / Tuần 10 (D2–D7, Tháng 11/2026)  
> **Tham chiếu:** [SRS.md](../requirements/SRS.md) (`FR-05`, `BR-10`, `AE-20`, `AE-21`, `NFR-03`, `NFR-06`, `NFR-08`), [tool_schemas.json](../architecture/tool_schemas.json), [api_contracts.md](../architecture/api_contracts.md)  
> **Bàn giao cho:** M1 — Nguyễn Phúc Minh (phục vụ task 1.3.4 — Review & Demo Sprint 1)

---

## 1. Mục tiêu và phạm vi thử nghiệm
- **Mục tiêu:** Kiểm chứng tính khả thi kỹ thuật của cơ chế gọi công cụ (Function/Tool Calling) bằng mô hình ngôn ngữ lớn (LLM), bảo đảm khả năng trích xuất tham số, tiêm ngữ cảnh bảo mật từ máy chủ, xử lý lỗi nhà cung cấp và đo lường độ trễ trước khi xây dựng chatbot hoàn chỉnh ở Sprint 3.
- **Phạm vi:** 
  - Thử nghiệm kỹ thuật (Technical Spike), **không phải chatbot hoàn chỉnh**.
  - Chỉ áp dụng cho các tool đọc (chưa thay đổi dữ liệu): `search_stations` và `get_station_detail`.
  - Nghiêm cấm LLM tự bịa trạm, tự tạo số liệu tồn kho hoặc ghi trực tiếp vào cơ sở dữ liệu (`BR-10`, `AE-20`).

---

## 2. Kết quả triển khai thành phần

| Thành phần | Đường dẫn | Trách nhiệm thực hiện |
| :--- | :--- | :--- |
| **Cấu hình & Bí mật** | `backend/app/core/config.py` | Nạp cấu hình an toàn qua `pydantic-settings`, che giấu API key khỏi nhật ký (`NFR-03`, `AE-23a`). |
| **Quản lý Tool Schema** | `backend/app/llm/schemas.py` | Đọc và kiểm tra tính hợp lệ trực tiếp từ `docs/architecture/tool_schemas.json`. |
| **Dịch vụ trạm mô phỏng** | `backend/app/services/station_stub.py` | Tính Haversine ($R=6371$ km), lọc theo dịch vụ, nhóm xe-pin, trạng thái mở, cự ly và thuật toán kiểm tra khả năng đặt pin (`booking_eligible`). |
| **Bộ chuyển đổi Tool** | `backend/app/llm/tool_adapter.py` | Thực thi danh sách cho phép (allowlist), kiểm tra lại tham số độc lập với LLM, tiêm vị trí và nhóm pin từ ngữ cảnh ứng dụng (`AD-05`, `BR-10`). |
| **Bộ điều phối hội thoại** | `backend/app/llm/orchestrator.py` | Điều phối vòng lặp tool calling (LLM $\to$ Tool $\to$ LLM), giới hạn số lượt (`LLM_MAX_TOOL_ROUNDS=3`), đo thời gian từng giai đoạn ($T_{\text{llm}}, T_{\text{tool}}, T_{\text{total}}$). |
| **Nhà cung cấp LLM** | `backend/app/llm/providers/` | `MockLLMProvider` phục vụ kiểm thử đơn vị/CI xác định; `GoogleGenAIProvider` kết nối Gemini API. |
| **Điểm cuối API thử nghiệm** | `backend/app/llm/spike_router.py` | Cung cấp endpoint `POST /api/v1/spike/llm-chat` cho kiểm thử tích hợp. |
| **Công cụ tương tác CLI** | `scripts/run_llm_spike.py` | Giao diện dòng lệnh tương tác trực tiếp để kiểm chứng hội thoại và xem log độ trễ. |

---

## 3. Kết quả kiểm thử tự động & Độ bao phủ mã nguồn (NFR-08)

Toàn bộ **43 test cases** tự động chạy thành công:
```text
tests/test_health.py ..                                                  [  4%]
tests/test_llm_helpers.py ..                                             [  9%]
tests/test_llm_spike.py .......................................          [100%]
43 passed in 0.45s
```

### Bảng độ bao phủ (Coverage Summary):
- **Tổng độ bao phủ:** **83%** (đáp ứng mục tiêu $\ge 80\%$ theo `NFR-08`).
- `station_stub.py`: **99%**
- `tool_adapter.py`: **94%**
- `orchestrator.py`: **94%**
- `schemas.py`: **100%**
- `config.py`: **100%**

---

## 4. Đo lường hiệu năng & Độ trễ (NFR-06, EN-105)

Thực hiện đo lường tách biệt giữa thời gian xử lý của mô hình AI và thời gian chạy công cụ nội bộ trên bộ dữ liệu mẫu 18 trạm:

| Chỉ số độ trễ | Trung vị (Median) | Bách phân vị 95 (p95) | Ghi chú |
| :--- | :---: | :---: | :--- |
| **Xử lý Tool nội bộ ($T_{\text{tool}}$)** | **0.03 ms** | **0.05 ms** | Tính toán Haversine và lọc 18 trạm trong bộ nhớ diễn ra tức thì. |
| **Phản hồi LLM Mock ($T_{\text{llm}}$)** | **0.01 ms** | **0.02 ms** | Chế độ Mock nội bộ phục vụ CI và kiểm thử tự động. |
| **Ước tính Provider thực tế (Gemini Flash)** | ~600 – 900 ms | ~1200 – 1800 ms | Phụ thuộc vào độ trễ mạng và nhà cung cấp Cloud. |

---

## 5. Kiểm chứng các ca đặc thù & Nguyên tắc an toàn

1. **Chống ảo giác số liệu (`AE-20`, `BR-10`):**
   - Không cho phép LLM tự tạo tọa độ hoặc số lượng pin. Nếu người dùng hỏi mà chưa có vị trí GPS/chọn trạm, tool adapter trả về mã `LOCATION_REQUIRED` hoặc `FAMILY_REQUIRED`.
   - Mô hình phản hồi bằng cách yêu cầu người dùng cung cấp thông tin thay vì tự suy đoán.
2. **Xử lý khi nhà cung cấp gặp sự cố (`AE-21`):**
   - Khi mô hình gặp lỗi kết nối, quá thời gian chờ (`LLM_TIMEOUT_MS=15000`), hoặc vượt giới hạn lượt gọi, hệ thống trả về mã hạ cấp `fallback: "MANUAL_FORM"`, hướng dẫn người dùng chuyển sang form tìm kiếm thủ công.
3. **Bảo mật khóa truy cập (`NFR-03`, `AE-23a`):**
   - Khóa API (`LLM_API_KEY`) chỉ tồn tại trên máy chủ, được che giấu trong mọi bản ghi log và bị loại bỏ khỏi Git qua `.gitignore`.

---

## 6. Khuyến nghị cho Sprint 3 (Nhiệm vụ 3.1.3)

1. **Chuẩn hóa Prompt:** Nên đưa các ví dụ mẫu (Few-shot examples) bằng tiếng Việt vào `SYSTEM_PROMPT` để mô hình hiểu tốt hơn các từ lóng như "hết điện", "đổi bình".
2. **Kiểm soát chi phí & Quota:** Cần áp dụng bộ đệm (cache) cho các câu hỏi trùng lặp hoặc đặt rate-limit chặt chẽ trên mỗi session (`LLM_RATE_LIMIT_PER_MINUTE=10`).
3. **Giữ nguyên luồng dữ liệu:** Giao diện người dùng ở Sprint 3 nên trực tiếp render danh sách trạm từ khối dữ liệu `tool_results` của API thay vì để LLM tự sinh lại dạng văn bản markdown để tránh sai lệch hiển thị.
