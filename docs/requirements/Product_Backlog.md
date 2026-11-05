# Danh sách yêu cầu sản phẩm Vinergy

Phiên bản 0.2. Cập nhật ngày 2 tháng 11 năm 2026. **Bản nháp — chờ nhóm rà soát.** Người phụ trách: M1. Tất cả câu chuyện người dùng và công việc hỗ trợ dưới đây đều đang ở giai đoạn lập kế hoạch, chưa được triển khai hoặc nghiệm thu. [SRS.md](SRS.md) là nguồn quy định nghiệp vụ; [các ví dụ nghiệm thu](Acceptance_Examples_and_Sample_Data.md) xác định kết quả mong đợi.

Mức ưu tiên thể hiện thứ tự thực hiện trong một sprint: P0 trước, sau đó đến P1. **Mỗi câu chuyện người dùng/công việc hỗ trợ được liệt kê đều là yêu cầu bắt buộc của phần sản phẩm bàn giao tương ứng. Các tiêu chí xuyên suốt tại US-304 áp dụng ngay từ phần bàn giao đầu tiên có tính năng liên quan; việc đặt câu chuyện này ở Sprint 3 thể hiện đợt kiểm chứng tích hợp cuối cùng.** Chức năng đặt pin/chat ở Sprint 2/3 không thuộc nhóm chỉ nên có hoặc có thể có. Mã WBS tham chiếu kế hoạch chi tiết; các liên kết có thể trùng nhau và không được cộng thành ước lượng điểm công việc (Story Point) mới. Tài liệu không bổ sung giả định về số giờ làm việc hoặc năng lực thực hiện của nhóm.

## Sprint 1 — Ngày 2–15 tháng 11 năm 2026

Mục tiêu: tìm trạm phù hợp qua danh sách/bản đồ và kiểm chứng cách tích hợp mô hình ngôn ngữ lớn (LLM). Thử nghiệm kỹ thuật này không đồng nghĩa với việc hoàn thành chatbot của Sprint 3.

| Mã / mức ưu tiên | Câu chuyện người dùng | Tiêu chí nghiệm thu có thể kiểm thử | Yêu cầu / ví dụ | WBS chi tiết |
| --- | --- | --- | --- | --- |
| US-101 / P0 | Là người dùng lái xe trong bản demo, tôi muốn dùng vị trí hiện tại hoặc nhập vị trí thủ công để vẫn tìm kiếm được khi không cấp quyền truy cập vị trí cho trình duyệt. | Tọa độ hợp lệ cho phép tìm kiếm; khi quyền bị từ chối hoặc không lấy được vị trí, cung cấp cách nhập thủ công; giải thích tọa độ thiếu/không hợp lệ mà không thay đổi tồn kho. | FR-01, FR-12; AE-04, AE-07 | 1.2.1, 1.2.3 |
| US-102 / P0 | Là người lái xe, tôi muốn lọc theo dịch vụ/nhóm pin/trạng thái và phạm vi pin để phân biệt các tài nguyên tương thích. | Tìm trạm đổi pin loại bỏ trạm chỉ sạc; chọn nhóm A loại bỏ trạm chỉ hỗ trợ B; mặc định loại bỏ trạm đóng cửa/bảo trì; trạm tương thích nhưng hết pin vẫn hiển thị là không còn pin khả dụng; khi tìm đổi pin theo mức pin hiện tại, loại bỏ trạm vượt quá cự ly di chuyển khả dụng (`distance_km > radius_km`). | FR-02, BR-02, BR-03; AE-01, AE-02, AE-03 | 1.1.2, 1.1.3, 1.2.2 |
| US-103 / P0 | Là người lái xe, tôi muốn danh sách sắp xếp theo khoảng cách được đồng bộ với bản đồ để so sánh các trạm gần mình. | Thứ tự theo khoảng cách Haversine chưa làm tròn và quy tắc dùng mã trạm khi bằng khoảng cách phải cho kết quả xác định; mã trạm trong danh sách và điểm đánh dấu khớp nhau; kết quả rỗng hợp lệ xóa các điểm đánh dấu cũ; lỗi phía máy chủ không được hiển thị như tìm kiếm thành công nhưng không có kết quả. | FR-03, BR-04, FR-12; AE-01, AE-05, AE-06 | 1.2.2, 1.2.3, 1.3.3 |
| US-104 / P1 | Là người lái xe, tôi muốn xem chi tiết trạm và chỉ đường để kiểm tra thông tin tài nguyên mô phỏng. | Hiển thị dịch vụ/nhóm pin/trạng thái/số lượng và thông báo dữ liệu mô phỏng; phân biệt số lượng bằng không với không hỗ trợ; điểm đến chỉ đường khớp tọa độ; không cam kết thời gian di chuyển. | FR-04, BR-01; AE-02, AE-03, AE-06 | 1.2.4 |
| US-105 / P1 | Là lập trình viên, tôi muốn thử nghiệm kỹ thuật gọi công cụ tìm kiếm bằng LLM để kiểm chứng tính khả thi của nhà cung cấp/công cụ trước khi xây dựng chức năng chat đầy đủ. | Ghi nhận một lần gọi công cụ trong phạm vi cho phép, cách xử lý thiếu tham số và lỗi nhà cung cấp; thực thi qua cùng lớp kiểm tra đầu vào/hợp đồng giao tiếp của thành phần giả lập; ghi lại kết quả thử nghiệm thay vì tuyên bố đã hoàn thành chat. | FR-05, BR-10; AE-20, AE-21 | 1.1.2, 1.3.2 |

Phụ thuộc: câu chuyện người dùng, quy tắc dữ liệu và bản nháp kiến trúc định hướng công việc giao diện/API; hợp đồng giao tiếp nháp cho phép một số công việc diễn ra song song. Kiểm thử tích hợp và rà soát tìm kiếm thực hiện sau khi giao diện/API hoạt động. Quan hệ phụ thuộc và khoảng ngày cụ thể giữ theo kế hoạch chi tiết.

## Sprint 2 — Ngày 16–29 tháng 11 năm 2026

Mục tiêu: tạo và quản lý việc giữ một pin mô phỏng qua biểu mẫu mà không làm sai lệch tồn kho.

| Mã / mức ưu tiên | Câu chuyện người dùng | Tiêu chí nghiệm thu có thể kiểm thử | Yêu cầu / ví dụ | WBS chi tiết |
| --- | --- | --- | --- | --- |
| US-201 / P0 | Là người lái xe, tôi muốn xác nhận đặt một pin tương thích để xem đơn đã thực sự giữ pin. | Số lượng là số nguyên 1; bản nháp đặt pin không giữ tồn kho; bước xác nhận rõ ràng hiển thị trạm/nhóm pin/số lượng; mỗi bản nháp chỉ được sử dụng để tạo đơn tối đa một lần, kể cả khi các yêu cầu khác khóa chạy đồng thời; kiểm tra lại OPEN/SWAPPING/tính tương thích/tồn kho trong một thao tác nguyên tử; chỉ trả mã đơn sau khi thành công. | FR-06, BR-05…BR-07; AE-08, AE-09, AE-10, AE-13, AE-17 | 2.1.1, 2.1.2, 2.1.3, 2.2.1, 2.2.2 |
| US-202 / P0 | Là người lái xe, tôi muốn xem các đơn của mình và gửi lại yêu cầu an toàn để việc mất phản hồi không tạo thêm lượt giữ pin. | Người khác không thể xem/hủy đơn của tôi; cùng khóa và nội dung yêu cầu trả về cùng một đơn ngay cả khi bản nháp hết hạn hoặc nhiều yêu cầu gửi lại đồng thời; thay đổi nội dung dưới cùng khóa gây xung đột; khóa mới không được dùng lại bản nháp đã tạo đơn; định danh yêu cầu gửi lại độc lập với quyết định còn mở về giới hạn số đơn đang hoạt động. | FR-07, BR-06, BR-08, BR-10; AE-11, AE-12, AE-14, AE-17 | 2.2.1, 2.2.3, 2.2.4 |
| US-203 / P0 | Là người lái xe, tôi muốn hủy đơn đang hoạt động để pin đang giữ trở lại trạng thái khả dụng. | Lệnh hủy được ghi nhận thành công trước khi hết hạn chuyển ACTIVE → CANCELLED và hoàn lại một pin; tại hoặc sau thời điểm hết hạn, đối soát sang EXPIRED; hủy lặp lại không thay đổi thêm; giao diện tải lại trạng thái từ máy chủ. | FR-08, BR-09; AE-15, AE-16 | 2.2.4, 2.2.5 |
| US-204 / P0 | Là người lái xe, tôi muốn trạng thái giữ pin hết hạn được phản ánh chính xác để pin không bị giữ vô thời hạn. | Khi đọc/gửi lại yêu cầu/hủy đơn đã quá hạn, đối soát sang EXPIRED; tác vụ nền giải phóng các lượt giữ không có yêu cầu truy cập trong độ trễ đã thống nhất; xử lý hủy và hết hạn đồng thời chỉ hoàn pin một lần; gửi lại yêu cầu cho đơn đã kết thúc không bao giờ tạo lượt giữ mới. | FR-09, BR-08, BR-09; AE-11, AE-16 | 2.2.5, 2.3.2 |

Phụ thuộc: thống nhất quy tắc, xác nhận bản nháp và trạng thái API trước khi triển khai; hoàn tất kiểm tra giao dịch và quyền sở hữu trước khi tuyên bố nghiệm thu phần đặt pin qua biểu mẫu. Chuẩn bị kiểm thử từ sớm; kiểm thử đồng thời/hết hạn cuối cùng cần vòng đời đơn đã tích hợp đầy đủ.

## Sprint 3 — Ngày 30 tháng 11–13 tháng 12 năm 2026

Mục tiêu: hoàn thiện chat trong phạm vi cho phép trên phần máy chủ đã kiểm thử, kiểm chứng phần sản phẩm cuối cùng và chuẩn bị bản phát hành đã đóng băng để thuyết trình.

| Mã / mức ưu tiên | Câu chuyện người dùng | Tiêu chí nghiệm thu có thể kiểm thử | Yêu cầu / ví dụ | WBS chi tiết |
| --- | --- | --- | --- | --- |
| US-301 / P0 | Là người lái xe, tôi muốn hỏi về trạm sạc/đổi pin gần mình để tìm kiếm bằng ngôn ngữ tự nhiên. | Hỏi lại khi thiếu vị trí/nhóm pin/dịch vụ; sử dụng thứ tự do máy chủ tính; phân biệt hết pin với không tương thích; chỉ hiển thị kết quả có căn cứ từ dữ liệu nguồn. | FR-10, BR-03, BR-10; AE-18, AE-19, AE-20 | 3.1.1, 3.1.2, 3.1.3, 3.1.4, 3.1.5 |
| US-302 / P0 | Là người lái xe, tôi muốn chat hỗ trợ đặt một pin để xác nhận được đơn hợp lệ giống như khi dùng biểu mẫu. | Chọn trạm đổi pin gần nhất hiện đủ điều kiện (nằm trong phạm vi di chuyển của pin hiện tại); bản nháp không giữ pin; yêu cầu xác nhận gắn với đúng bản nháp; kiểm tra lại tồn kho; báo không khả dụng và không tạo bản nháp nếu không có trạm đủ điều kiện trong phạm vi; không bịa kết quả thành công hoặc tạo đơn trùng khi gửi lại yêu cầu/dùng lại bản nháp. | FR-11, BR-06…BR-10; AE-09…AE-13, AE-17…AE-20 | 3.1.3, 3.1.4, 3.1.5, 3.2.2 |
| US-303 / P0 | Là người lái xe, tôi muốn khôi phục an toàn khi công cụ/nhà cung cấp gặp lỗi để chuyển sang biểu mẫu mà không nhận kết quả gây hiểu nhầm. | Phân biệt kết quả rỗng/không khả dụng/lỗi; giữ trạng thái chưa rõ kết quả xác nhận và đối soát bằng cùng khóa; cung cấp biểu mẫu thay thế; thời gian chờ và giới hạn được cấu hình, rà soát. | FR-12, NFR-02, NFR-03; AE-05, AE-06, AE-21 | 3.2.1, 3.2.2, 3.1.5 |
| US-304 / P1 | Là người lái xe, tôi muốn các thành phần điều khiển dễ sử dụng, thể hiện rõ tính mô phỏng và bảo vệ quyền riêng tư để thao tác bản demo mà không làm lộ dữ liệu không cần thiết. | Áp dụng thao tác bàn phím, nhãn/thông báo lỗi rõ ràng, thông báo mô phỏng, bảo vệ quyền riêng tư và xử lý khóa ngay từ tính năng liên quan đầu tiên; Sprint 3 kiểm tra lại AE-23 trên toàn bộ luồng chính. | BR-01, NFR-03…NFR-05; AE-23 | Ban đầu: 1.1.2, 1.2.1, 1.2.3, 1.3.1; đặt pin: 2.1.2, 2.1.3; cuối cùng: 3.1.2, 3.1.5, 3.2.3 |

## Công việc kỹ thuật và phát hành bắt buộc

| Mã | Đầu ra bắt buộc | WBS / cách kiểm chứng |
| --- | --- | --- |
| EN-101 | Bản nháp yêu cầu, kiến trúc/hợp đồng giao tiếp công cụ và sơ đồ thực thể–quan hệ/bộ dữ liệu mẫu 18 bản ghi | 1.1.1–1.1.3; đối chiếu SRS/danh sách yêu cầu/ví dụ với kế hoạch; chờ M2/M4 rà soát |
| EN-102 | Khung ứng dụng chạy được, cấu hình và thiết lập quy trình dựng/kiểm thử tự động | 1.3.1; không đưa thông tin bí mật vào kho mã; tái tạo được môi trường từ đầu |
| EN-103 | Kế hoạch/kết quả kiểm thử tìm kiếm, đặt pin và chat; các đợt rà soát và kiểm thử chấp nhận người dùng nội bộ | 1.3.3–1.3.4, 2.3.1–2.3.3, 3.3.1–3.3.4; AE-01…AE-24; ghi nhận bằng chứng thực tế sau |
| EN-104 | Mã thực thi nạp/đặt lại dữ liệu và tài liệu phát hành do M1 thực hiện sau này, tái sử dụng dữ liệu/mã thay đổi cấu trúc cơ sở dữ liệu của M4; bộ yêu cầu hiện tại chỉ cung cấp dữ liệu/đặc tả | FR-13, NFR-07; M4 1.1.3, M1 3.2.3, 3.3.4; AE-22 |
| EN-105 | Đo độ trễ theo từng thành phần và thống nhất chỉ tiêu định lượng, không tự đặt ra số liệu | NFR-06; 1.3.2–1.3.3, 3.3.2; AE-24 |
| EN-106 | Bản phát hành đã đóng băng, README/hướng dẫn vận hành/báo cáo/trang trình chiếu/video, diễn tập và buổi thuyết trình cuối cùng | 3.2.3, 3.3.4, 4.1, 4.2; toàn bộ tài liệu sẵn sàng vào cuối W15, chỉ thuyết trình ngày 17 tháng 12 |
| EN-107 | Lời nhắc hệ thống, lược đồ JSON của công cụ và hội thoại mẫu được quản lý phiên bản; M1 soạn, M2/M6 rà soát và M6 tích hợp | 3.1.1, 3.1.3; BR-05…BR-10, AE-17…AE-21; đây là đầu ra triển khai sau này, chưa có lời nhắc/lược đồ được triển khai trong bản nháp yêu cầu này |

Không bổ sung câu chuyện về đặt chỗ sạc, vận hành/quản trị trạm, thanh toán hoặc thiết bị thật. Giới hạn số đơn đang hoạt động của mỗi người và thời lượng giữ pin vẫn là các quyết định còn mở trong SRS, không phải tiêu chí nghiệm thu ngầm định.

## Bàn giao và truy vết

Áp dụng các mốc chốt quyết định ở mục 8 của SRS trước công việc triển khai/nghiệm thu phụ thuộc. Giữ nguyên mã AE-01…AE-24; kiểm tra riêng từng tình huống con trong AE-01, AE-07, AE-11, AE-16, AE-17, AE-18 và AE-23. Chỉ tiêu chưa được chốt không được ghi nhận là đã đạt.

- M1 rà soát phạm vi, tiêu chí nghiệm thu câu chuyện người dùng và các quyết định chưa thống nhất.
- M2 sử dụng ý nghĩa đầu vào/đầu ra và các quy tắc nghiệp vụ bất biến để thiết kế kiến trúc/hợp đồng API.
- M3/M5 sử dụng UC-01…UC-04 để thiết kế khung giao diện, thành phần điều khiển, phương án thay thế khi lỗi và giao diện xác nhận.
- M4 sử dụng các quy tắc bất biến về dịch vụ/nhóm pin/số lượng của dữ liệu mẫu để thiết kế dữ liệu; M6 áp dụng cùng quy tắc cho công cụ.
- M7 xây dựng ca kiểm thử từ AE-01…AE-24. Ví dụ viết trong tài liệu **không phải kiểm thử đã được triển khai**; mục tiêu độ bao phủ ≥80% trong kế hoạch không phải kết quả đã đo.

Tên và vai trò thành viên giữ theo trang tính thành viên trong kế hoạch tổng. Danh sách này xác định yêu cầu, không lặp lại các cam kết thời gian hoặc điểm công việc trong các bản kế hoạch.
