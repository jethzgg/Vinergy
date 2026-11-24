# Kế hoạch Sprint 2 của M1 — Nguyễn Phúc Minh

Sprint 2 diễn ra từ **16–29/11/2026**. M1 phụ trách **2 nhiệm vụ, tổng 4 Story Points**. Mục tiêu là giúp nhóm thống nhất khi nào một pin thực sự được giữ, rồi dùng bản chạy và số liệu tồn kho để nghiệm thu luồng đặt pin qua biểu mẫu.

| WBS | Nhiệm vụ M1 chủ trì | Lịch WBS | Phụ thuộc trực tiếp | Đầu ra |
|---|---|---|---|---|
| **2.1.1** · 2 SP | Chốt quy tắc đặt pin và tiêu chí nghiệm thu | 16–18/11 · D15–D17 | 1.3.4 · Review Sprint 1 | Backlog đặt pin, quy tắc nghiệp vụ, ví dụ nghiệm thu |
| **2.3.3** · 2 SP | Cập nhật tài liệu và chủ trì review Sprint 2 | 29/11 · D28 | 2.1.3 · Thiết kế trạng thái/dữ liệu/API v2, 2.2.4 · Giao diện xem/hủy đơn, 2.3.2 · Kiểm thử tích hợp | SRS/API v2 và sơ đồ khớp bản chạy, demo biểu mẫu, biên bản review và ưu tiên Sprint 3 |

**Điểm bắt đầu ngày 24/11.** Mốc 16–18/11 là lịch gốc. Hồ sơ bàn giao hiện còn chờ quyết định của nhóm cho 1.3.4. M1 kiểm tra biên bản thực tế và bản quy tắc mới nhất trước tiên. Nếu nhóm đã chốt, liên kết phiên bản và chuyển ngay sang chuẩn bị review. Nếu còn mở, M1 có thể gửi dự thảo cho M3/M4/M7 dùng song song, ghi người quyết định và ngày hẹn cho từng điểm còn thiếu. Chỉ cập nhật trạng thái WBS theo kết quả thực tế.

## 2.1.1 · Chốt quy tắc để cả nhóm triển khai cùng một luồng

**Kết quả soạn ngày 24/11/2026.** M1 đã cập nhật [backlog US-201–US-204](../requirements/Product_Backlog.md), [FR-06 và chính sách ở mục 8 SRS](../requirements/SRS.md) cùng [AE-08–AE-17](../requirements/Acceptance_Examples_and_Sample_Data.md). AE-09a và AE-10b phân biệt hạn nháp với hạn giữ pin. AE-10a cung cấp năm ca từ chối trên trạm mẫu. AE-11a kiểm tra hai đơn độc lập của cùng người. Hồ sơ sẵn sàng để M3/M4/M7 sử dụng và phản hồi. Chưa có biên bản xác nhận các giá trị demo hoặc việc các thành viên đã nhận bàn giao.

- [x] Rà **US-201–US-204** trong backlog và **FR-06–FR-09** trong SRS. Với từng quy tắc, ghi điều kiện đầu vào, kết quả người dùng thấy, trạng thái đơn và số pin sau thao tác. Dùng bảng dưới để đối chiếu với M2, M3, M4, M6 và M7.

| Tình huống cần thống nhất | Kết quả dùng để nghiệm thu | Ví dụ |
|---|---|---|
| Lập nháp và xác nhận | Mỗi đơn giữ đúng một pin. Bản nháp giữ nguyên tồn kho. Trước khi xác nhận, biểu mẫu hiển thị trạm, nhóm pin, số lượng và thông tin thời hạn giữ. Chỉ hiện mã đơn khi máy chủ đã ghi nhận thành công. | AE-08–10 |
| Tồn kho thay đổi trước xác nhận | Máy chủ kiểm tra lại trạm đang mở, có dịch vụ đổi pin, hỗ trợ đúng nhóm và còn pin trong cùng giao dịch tạo đơn. Nếu chỉ còn một pin và hai người cùng xác nhận thì chỉ một người nhận đơn. | AE-10, AE-13, AE-17 |
| Gửi lại xác nhận hoặc dùng nháp cũ | Cùng khóa và cùng nội dung trả về cùng đơn ở trạng thái hiện tại. Đổi nội dung dưới cùng khóa báo xung đột. Một bản nháp chỉ tạo được tối đa một đơn, kể cả khi dùng khóa khác. | AE-11, AE-12, AE-17 |
| Xem và hủy đơn | Chỉ chủ đơn được xem hoặc hủy. Người khác bị từ chối, tồn kho giữ nguyên. Hủy hợp lệ trước hạn chuyển sang `CANCELLED` và hoàn đúng một pin, kể cả khi nhấn hủy lần nữa. | AE-14, AE-15 |
| Đến hạn giữ | Tại hoặc sau mốc hết hạn theo đồng hồ máy chủ, đơn chuyển sang `EXPIRED`. Hủy và hết hạn cùng xảy ra cũng chỉ hoàn một pin. | AE-16 |

- [ ] **Xác nhận chính sách demo.** M1/M2 rà soát giới hạn đơn đang giữ. M1/M2/M4 rà soát hai thời hạn đề xuất ở mục 8 SRS. Khi nhóm quyết định, ghi người xác nhận và ngày áp dụng. Chu kỳ xử lý nền, độ trễ hoàn pin và phục hồi được chuyển cho M2/M6/M7 ở 2.1.3.
- [ ] **Bàn giao cùng một phiên bản.** M3 dùng nội dung xác nhận cho giao diện 2.1.2. M4 dùng quy tắc chuyển trạng thái và giữ pin cho 2.1.3. M2 đối chiếu quyền sở hữu và gửi lại yêu cầu, M6 đối chiếu hủy/hết hạn. M7 nhận ví dụ để xây dựng dữ liệu và ca lỗi ở 2.3.1.

**Hoàn thành 2.1.1 khi** backlog, SRS và ví dụ nghiệm thu thống nhất về các trường hợp trên. M1 ghi rõ quyết định đã chốt, các ngoại lệ còn mở cùng ảnh hưởng của chúng, và gửi đường dẫn đúng phiên bản cho người nhận.

## 2.3.3 · Chuẩn bị minh chứng và chủ trì review

| Mốc đề xuất | Việc M1 làm | Bằng chứng cần có |
|---|---|---|
| **24–25/11** | Đối chiếu quy tắc với thiết kế 2.1.3 của M4. Rà màn hình xác nhận với M3, màn hình danh sách/chi tiết/hủy đơn với M5. | Liên kết dự thảo SRS/API v2, sơ đồ trạng thái và trình tự, danh sách điểm còn lệch cùng người xử lý. |
| **26–28/11** | Chuẩn bị và chạy thử kịch bản bên dưới trên bản tích hợp. Nhận kết quả 2.3.2 từ M7, gồm ca tranh pin cuối, gửi lại, sai chủ đơn, hủy và hết hạn. | Mã commit, môi trường/CSDL, dữ liệu đầu vào, kết quả thực tế, lỗi còn mở. Ghi riêng ca chưa chạy. |
| **29/11** | Kiểm tra trạng thái của 2.1.3, 2.2.4 và 2.3.2. Khi đủ đầu vào, chủ trì demo, đối chiếu tài liệu với bản chạy và ghi quyết định của nhóm. | Biên bản có người tham dự, phần được chấp thuận hoặc cần sửa, người nhận việc, ngày tái kiểm và ưu tiên Sprint 3. |

**Kịch bản demo bằng dữ liệu mẫu** — chạy trên CSDL demo riêng. M1 điều phối và ghi kết quả, M7 cung cấp bằng chứng kiểm thử cho các ca đồng thời.

1. Tìm ST-01 với nhóm FAM_A và đối chiếu số pin ban đầu là **6**. Tạo bản nháp một pin. Trước khi bấm xác nhận, tồn kho vẫn là **6**.
2. Xác nhận trên biểu mẫu. Mở đơn vừa tạo và đối chiếu trạng thái `ACTIVE`, đúng trạm, đúng nhóm và tồn kho **5**. Gửi lại cùng xác nhận phải trả về đúng mã đơn, kho vẫn **5**.
3. Mở đơn bằng phiên của chủ đơn, hủy trước hạn rồi tải lại. Đơn hiển thị `CANCELLED`, kho về **6**. Lặp lại thao tác hủy, kho vẫn **6**.
4. Đối chiếu hai bằng chứng độc lập của M7. Với một đơn đến hạn, trạng thái là `EXPIRED` và chỉ một pin được hoàn. Với bộ dữ liệu riêng còn đúng một pin, hai xác nhận đồng thời tạo đúng một đơn, kho còn **0**.

**Hoàn thành 2.3.3 khi** nhóm đã xem luồng tìm → đặt → xem → hủy, có bằng chứng cho các rủi ro về tồn kho, và biên bản dẫn tới đúng bản chạy, tài liệu, kết quả test. Nếu có phần cần sửa, ghi quyết định và lịch tái kiểm. Một mục bàn giao cụ thể cho Sprint 3 là cho công cụ chat đọc cùng nguồn tồn kho với biểu mẫu. Trong lần thử Sprint 1, API đã trả 0 pin ở ST-01 trong khi công cụ chat vẫn trả 6.

## Nguồn đối chiếu

- Phân công, điểm, lịch, phụ thuộc và tiêu chí review lấy từ sheet **Agile Sprint Plan**, dòng 19 và 31, cùng sheet **Deliverables & Review**. [WBS chi tiết](Vinergy_Detail_Plan.pdf)
- Quy tắc và ví dụ cần cập nhật khi thực hiện 2.1.1. [Product Backlog](../requirements/Product_Backlog.md) · [SRS](../requirements/SRS.md) · [Acceptance Examples](../requirements/Acceptance_Examples_and_Sample_Data.md)
- Trạng thái bàn giao và các quyết định còn chờ ở đầu Sprint 2. [Hồ sơ review Sprint 1](1.3.4-sprint-1-review.md)
