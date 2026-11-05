# Vinergy — Ví dụ nghiệm thu và dữ liệu mẫu

Phiên bản 0.2. Cập nhật ngày 2 tháng 11 năm 2026. **Bản nháp — đang chờ rà soát; các ví dụ chưa phải là kiểm thử đã được triển khai.** M4 rà soát bộ dữ liệu mẫu và thiết kế dữ liệu; M7 xây dựng ca kiểm thử từ các ví dụ; M1 rà soát hành vi mong muốn. [SRS](SRS.md) là nguồn chuẩn cho mã yêu cầu và quy tắc; [danh sách công việc sản phẩm](Product_Backlog.md) liên kết chúng với các công việc cần thực hiện.

## Bộ dữ liệu mẫu ban đầu

Sử dụng [seed_stations_v0.json](../../data/seed_stations_v0.json): 18 trạm giả lập, `FAM_A`/`FAM_B`, người dùng thử nghiệm `USER-A`/`USER-B`, không có bản nháp đặt pin hoặc đơn đặt pin ban đầu. Tọa độ gần đúng và số lượng lấy từ đề xuất được cung cấp, chưa được xác minh là địa điểm dịch vụ có thật. Tên và nhãn khu vực mang tính minh họa, không liên kết với nhà sản xuất hoặc đơn vị vận hành nào. Các số lượng không xác nhận thành phần hóa học, điện áp, mức sạc hoặc khả năng tương thích với xe thực tế.

Khôi phục **bản sao kiểm thử độc lập** về trạng thái ban đầu trước mỗi ví dụ, trừ khi phần thiết lập quy định thay đổi riêng. Tài liệu này không cung cấp chương trình nạp/đặt lại dữ liệu có thể thực thi. Công cụ đặt lại dữ liệu được xây dựng sau này phải đáp ứng FR-13; không bao giờ đặt lại dữ liệu dùng chung hoặc dữ liệu thật thông qua giao diện người lái xe.

| Trường dữ liệu mẫu | Ý nghĩa/quy tắc bất biến |
| --- | --- |
| `services` | Mảng chứa CHARGING và/hoặc SWAPPING; không có giá trị liệt kê BOTH riêng |
| `supported_families` | Khai báo khả năng tương thích giả lập cho các dịch vụ được liệt kê; độc lập với tồn kho hiện tại |
| `opening_status` | Trạng thái mẫu làm căn cứ OPEN/CLOSED/MAINTENANCE; không suy ra giờ mở cửa theo thời gian thực |
| `available_batteries_by_family` | Số lượng nguyên không âm, chỉ dành cho các nhóm pin được hỗ trợ đổi pin |
| `available_charging_ports_by_family` | Số lượng nguyên không âm, chỉ dành cho các nhóm được hỗ trợ sạc; chỉ dùng để tìm kiếm |
| Ánh xạ tài nguyên rỗng | Dịch vụ không được hỗ trợ; khác với một nhóm được hỗ trợ nhưng có số lượng bằng không |
| `origins` | LOC-01=(21.0050,105.8435), LOC-02=(21.0285,105.8542), LOC-03=(21.2,105.2) |

ST-02/ST-07/ST-17 chỉ có sạc. ST-03/ST-15 chỉ đổi pin nhóm A; ST-04/ST-12 chỉ đổi pin nhóm B. ST-05 hỗ trợ A nhưng không còn pin A. ST-09 ở trạng thái CLOSED với số lượng dương; ST-13 ở trạng thái MAINTENANCE với số lượng bằng không. Phải phân biệt được những trường hợp này.

### Giá trị khoảng cách chuẩn để đối chiếu

Haversine: `a = sin²(Δlat/2) + cos(lat1)cos(lat2)sin²(Δlng/2)`; `distance_km = 2 × 6371 × asin(min(1, sqrt(a)))`, với góc tính bằng radian. Sắp xếp theo giá trị chưa làm tròn, sau đó theo mã trạm khi khoảng cách bằng nhau hoàn toàn. Hiển thị một chữ số thập phân; không sắp xếp theo nhãn đã làm tròn.

Khoảng cách từ LOC-01, tính từ tọa độ trong bộ dữ liệu mẫu (giá trị dưới đây được làm tròn đến sáu chữ số thập phân để trình bày):

| Trạm | Khoảng cách đối chiếu (km) | Hiển thị (km) |
| --- | ---: | ---: |
| ST-01 | 0.000000 | 0.0 |
| ST-02 | 2.693266 | 2.7 |
| ST-03 | 0.934066 | 0.9 |
| ST-04 | 1.284229 | 1.3 |
| ST-05 | 1.312928 | 1.3 |
| ST-06 | 1.653278 | 1.7 |
| ST-07 | 3.298900 | 3.3 |
| ST-08 | 2.474380 | 2.5 |
| ST-09 | 2.181404 | 2.2 |
| ST-10 | 4.385670 | 4.4 |
| ST-11 | 7.251966 | 7.3 |
| ST-12 | 6.837912 | 6.8 |
| ST-13 | 4.374298 | 4.4 |
| ST-14 | 2.919854 | 2.9 |
| ST-15 | 5.358737 | 5.4 |
| ST-16 | 2.843062 | 2.8 |
| ST-17 | 4.555453 | 4.6 |
| ST-18 | 6.269174 | 6.3 |

ST-01 và LOC-01 có cùng tọa độ nên khoảng cách là **0.0 km**, không phải 0.2/0.3 km như trong các bản đề xuất. Đây là khoảng cách toán học giữa các điểm minh họa, không phải bằng chứng về một trạm có thật ở gần.

## Ví dụ nghiệm thu

Mỗi ví dụ xác định hành vi mong đợi và dữ liệu ban đầu. Các loại kết quả dưới đây mô tả ý nghĩa nghiệp vụ; mã phản hồi và cấu trúc dữ liệu API cuối cùng đang chờ M2/M4 rà soát. Các ví dụ đặt pin thuộc Sprint 2; các ví dụ hội thoại hoàn chỉnh thuộc Sprint 3. Thử nghiệm kỹ thuật trong Sprint 1 có thể kiểm tra lớp kiểm soát công cụ liên quan bằng dữ liệu giả lập/dùng chung, nhưng không được coi các yêu cầu của sprint sau là đã hoàn thành.

### AE-01 — Tìm trạm tương thích và sắp xếp đúng

Yêu cầu: FR-02, FR-03, BR-03, BR-04.

**Cho trước** dữ liệu ban đầu, LOC-01, SWAPPING, FAM_A, mặc định `only_open=true`, bán kính 2 km. **Khi** người dùng tìm kiếm qua biểu mẫu/dịch vụ dùng chung. **Thì** thứ tự mã trạm là **ST-01, ST-03, ST-05, ST-06**, hiển thị 0.0, 0.9, 1.3 và 1.7 km. Mã trạm trong danh sách và trên dấu đánh dấu bản đồ phải khớp nhau. ST-05 vẫn hiển thị với số pin A bằng không và chức năng đặt pin bị vô hiệu hóa. Không có pin nào được giữ chỗ.

**Trường hợp con — khoảng cách bằng nhau:** Trong bản sao độc lập, đặt tọa độ ST-03 bằng ST-01, giữ cả hai ở OPEN/SWAPPING/FAM_A. Lặp lại cùng phép tìm kiếm. ST-01 phải đứng trước ST-03 khi khoảng cách chưa làm tròn bằng nhau, bất kể thứ tự bản ghi đầu vào. Sau đó khôi phục dữ liệu ban đầu.

### AE-02 — Phân biệt không tương thích với hết pin

Yêu cầu: FR-02, FR-04, BR-03.

**Cho trước** phép tìm kiếm FAM_A. **Khi** so sánh ST-04 và ST-05. **Thì** ST-04 bị loại vì chỉ hỗ trợ FAM_B, dù có năm pin B; khi xem trực tiếp thông tin chi tiết phải thể hiện sự không tương thích. ST-05 tương thích và có thể tìm thấy nhưng không thể đặt pin A. Không gắn nhãn không tương thích cho trạm này hoặc suy ra khả năng hỗ trợ từ tồn kho.

### AE-03 — Tách biệt sạc và đổi pin

Yêu cầu: FR-02, FR-04, FR-06, BR-02.

**Cho trước** ST-02 ở trạng thái OPEN, chỉ có sạc và có năm cổng sạc A. **Khi** tìm CHARGING/FAM_A không giới hạn bán kính. **Thì** trạm xuất hiện cùng số cổng sạc giả lập. **Khi** tìm SWAPPING/FAM_A hoặc thử tạo bản nháp/xác nhận đặt pin tại ST-02. **Thì** trạm bị loại khỏi kết quả đổi pin và yêu cầu đặt pin bị từ chối, không thay đổi tồn kho hay đơn. Không cung cấp thao tác đặt cổng sạc.

### AE-04 — Từ chối quyền vị trí và nhập vị trí thủ công

Yêu cầu: FR-01, FR-12, NFR-02.

**Cho trước** người lái xe từ chối quyền truy cập vị trí của trình duyệt. **Khi** tìm kiếm mà chưa có tọa độ. **Thì** yêu cầu cung cấp vị trí, không làm ứng dụng ngừng hoạt động hoặc âm thầm tạo ra vị trí. **Khi** người lái xe chọn LOC-02 thủ công và cung cấp dịch vụ/nhóm pin. **Thì** có thể tải kết quả hợp lệ. Đổi vị trí thủ công phải tính lại kết quả, không âm thầm dùng tọa độ cũ.

### AE-05 — Kết quả rỗng khác với lỗi máy chủ

Yêu cầu: FR-03, FR-12, NFR-02.

**Cho trước** bản đồ đang có các dấu đánh dấu cũ, LOC-03, SWAPPING/FAM_A, bán kính 0.5 km. **Khi** tìm kiếm thành công. **Thì** trả kết quả rỗng, xóa các dấu đánh dấu cũ và đề xuất đổi bộ lọc/vị trí. **Khi** máy chủ hết thời gian chờ. **Thì** hiển thị trạng thái lỗi dịch vụ/thử lại, không coi đó là tìm kiếm thành công với kết quả rỗng; gắn nhãn hoặc xóa dữ liệu cũ cho phù hợp.

### AE-06 — Chỉ bản đồ gặp lỗi thì danh sách vẫn hoạt động

Yêu cầu: FR-03, FR-04, FR-12, NFR-02.

**Cho trước** tìm kiếm phía máy chủ hoạt động nhưng tải Maps thất bại. **Khi** người lái xe nhập LOC-01 thủ công và tìm kiếm. **Thì** giữ danh sách/thông tin chi tiết và giải thích rằng bản đồ không khả dụng. Không khẳng định đồng bộ danh sách/bản đồ thành công khi bản đồ không hoạt động. Chỉ đường qua dịch vụ bên ngoài vẫn phải dùng tọa độ trạm đã chọn nếu có thể mở dịch vụ đó.

### AE-07 — Dữ liệu đầu vào không hợp lệ

Yêu cầu: FR-01, FR-02, BR-10.

Thực hiện độc lập từng phép kiểm tra, với các đầu vào còn lại hợp lệ theo LOC-01/SWAPPING/FAM_A. Yêu cầu bị từ chối không làm thay đổi đơn hoặc tồn kho.

- [ ] AE-07a: Vĩ độ/kinh độ bị thiếu, không phải số, không hữu hạn hoặc ngoài phạm vi phải tạo lỗi xác thực theo từng trường.
- [ ] AE-07b: Nhóm pin hoặc dịch vụ bị thiếu/không được nhận diện phải tạo lỗi xác thực theo từng trường.
- [ ] AE-07c: Bán kính được cung cấp (tương ứng cự ly pin khả dụng) nhưng không phải số, không dương hoặc không hữu hạn phải bị từ chối.
- [ ] AE-07d: Không cung cấp bán kính thì xét tất cả trạm mẫu phù hợp; không cung cấp only_open thì xử lý như true.
- [ ] AE-07e: Cung cấp rõ only_open=false có thể đưa vào các bản ghi tương thích ở CLOSED/MAINTENANCE như ST-09/ST-13, nhưng vô hiệu hóa đặt pin; giá trị không phải boolean bị từ chối.
- [ ] AE-07f: Tọa độ hợp lệ nằm ngoài khu vực dữ liệu mẫu vẫn hợp lệ; LOC-03 với bán kính 0.5 km cho kết quả rỗng, không phải lỗi định dạng đầu vào.

### AE-08 — Số lượng phải đúng bằng số nguyên một

Yêu cầu: FR-06, BR-05.

**Cho trước** ST-01 có sáu pin A. **Khi** yêu cầu tạo bản nháp/đặt pin thiếu `quantity` hoặc dùng 0, −1, 2, 1.5, chuỗi `"1"`, boolean true hoặc một mảng. **Thì** từ chối; số lượng và đơn không đổi. **Khi** số lượng là số nguyên 1 và tất cả kiểm tra khác đều đạt. **Thì** có thể tiếp tục tạo bản nháp/xác nhận. Kiểm tra này không áp đặt quy tắc mỗi người chỉ có một đơn đang hoạt động.

### AE-09 — Đề xuất đặt pin không giữ tồn kho

Yêu cầu: FR-06, BR-06, FR-11.

**Cho trước** USER-A và ST-01/FAM_A/quantity 1. **Khi** biểu mẫu/hội thoại chuẩn bị bản nháp và hiển thị đề xuất nhưng người dùng chưa xác nhận. **Thì** tồn kho A khả dụng vẫn là sáu và chưa có đơn ACTIVE. Quy tắc này cũng áp dụng cho bản nháp bị bỏ dở.

### AE-10 — Xác nhận và giữ pin đúng một lần bằng thao tác nguyên tử

Yêu cầu: FR-06, BR-07.

**Cho trước** bản nháp hợp lệ của USER-A cho ST-01/FAM_A/quantity 1 và khóa chống xử lý trùng mới (idempotency key). **Khi** USER-A xác nhận. **Thì** tạo một đơn ACTIVE có mã đơn và thời hạn do máy chủ xác định, giảm tồn kho A từ sáu xuống năm; tồn kho B và số cổng sạc không đổi. Nếu trạng thái/dịch vụ/nhóm pin/tồn kho của trạm thay đổi trước xác nhận, phải từ chối mà không tạo đơn dang dở.

### AE-11 — Gửi lại sau khi mất phản hồi phải trả về cùng đơn

Yêu cầu: FR-07, FR-12, BR-08.

**Cho trước** giao dịch trong AE-10 đã ghi nhận thành công nhưng phản hồi bị mất. **Khi** USER-A gửi lại cùng xác nhận/khóa/nội dung yêu cầu. **Thì** trả về đơn ban đầu và trạng thái hiện tại; tồn kho A vẫn là năm. Nếu đơn sau đó hết hạn/bị hủy, gửi lại trả về chính đơn đó ở trạng thái kết thúc, không kích hoạt lại hoặc giữ thêm pin. Một yêu cầu hợp lệ riêng biệt với bản nháp mới và khóa mới không tự động bị từ chối chỉ vì đã có đơn đang hoạt động; giới hạn này vẫn là quyết định chưa chốt.

**Trường hợp con — gửi lại khi bản nháp đã hết hạn:** Sau khi ghi nhận thành công nhưng mất phản hồi, đưa đồng hồ vượt quá hạn bản nháp và gửi lại cùng khóa/nội dung yêu cầu đã được xác thực quyền. Trả về đơn ban đầu/trạng thái hiện tại, không từ chối vì bản nháp cũ hết hạn. Đối soát việc hết hạn đơn theo BR-09 khi áp dụng; không tạo lượt giữ pin mới ngay cả khi điều kiện hợp lệ của trạm đã thay đổi.

**Trường hợp con — gửi đồng thời cùng khóa:** Bắt đầu từ dữ liệu ban đầu, đồng thời gửi hai xác nhận giống nhau, đã được xác thực quyền, với cùng khóa/nội dung yêu cầu. Kết quả chỉ có đúng một đơn và một lượt giữ pin (sáu pin A còn năm). Cả hai kết quả sau khi xử lý xong đều chỉ đến đơn đó. Phản hồi tạm thời đang xử lý có thể yêu cầu thử lại cùng khóa; không được tạo thêm đơn.

### AE-12 — Nội dung thay đổi không được dùng lại khóa

Yêu cầu: FR-06, BR-08.

**Cho trước** khóa ban đầu đã gắn với đơn ST-01/FAM_A. **Khi** cùng người dùng dùng lại khóa đó với nội dung trạm/nhóm pin/bản nháp khác. **Thì** trả lỗi xung đột khóa chống xử lý trùng; không tạo đơn mới và không thay đổi tồn kho của bất kỳ trạm nào. Không nhầm trường hợp này với xác thực số lượng.

### AE-13 — Cạnh tranh đặt viên pin cuối cùng

Yêu cầu: FR-06, NFR-01, BR-07.

**Cho trước** bản sao độc lập được điều chỉnh để ST-01/FAM_A chỉ còn một pin khả dụng, cùng các bản nháp/khóa hợp lệ riêng biệt của USER-A/USER-B. **Khi** hai xác nhận chạy đồng thời. **Thì** đúng một yêu cầu tạo đơn ACTIVE, yêu cầu còn lại báo không còn pin khả dụng và tồn kho khả dụng bằng không, không bao giờ âm. Tổng số lượt giữ pin mới đang hoạt động là một, kể cả khi biểu mẫu và hội thoại cùng phát sinh yêu cầu.

### AE-14 — Bên gọi không được tự khai quyền sở hữu

Yêu cầu: FR-07, FR-08, BR-10, NFR-03.

**Cho trước** USER-A sở hữu một đơn. **Khi** USER-B thử xem/hủy đơn, kể cả bằng cách chèn USER-A vào phần thân yêu cầu/tham số công cụ. **Thì** từ chối truy cập mà không lộ nội dung đơn hoặc giải phóng tồn kho. Quyền truy cập được xác định bằng phiên đáng tin cậy, không phải văn bản do mô hình cung cấp.

### AE-15 — Hủy đơn chỉ hoàn lại pin một lần

Yêu cầu: FR-08, BR-09.

**Cho trước** ban đầu có sáu pin A và một lượt giữ pin đã xác nhận của USER-A làm số pin còn năm. **Khi** USER-A hủy trước hạn rồi lặp lại thao tác hủy. **Thì** trạng thái là CANCELLED và tồn kho trở lại sáu đúng một lần, không bao giờ thành bảy. Làm mới giao diện theo trạng thái máy chủ.

### AE-16 — Mốc hết hạn và cạnh tranh giữa hủy với hết hạn

Yêu cầu: FR-09, BR-09, NFR-01.

Sử dụng đồng hồ máy chủ có thể điều khiển và một lượt giữ pin đang hoạt động khiến số pin A còn năm. Đặt lại dữ liệu giữa các trường hợp con.

- [ ] AE-16a: Thao tác hủy được ghi nhận trước thời hạn E trả CANCELLED và khôi phục tồn kho về sáu; xử lý hết hạn sau đó không thay đổi gì.
- [ ] AE-16b: Tạm dừng tiến trình xử lý hết hạn và đưa thời gian đến E hoặc muộn hơn. Thao tác đọc/gửi lại/hủy đã được xác thực quyền phải đối soát đơn quá hạn thành EXPIRED và khôi phục tồn kho về sáu trước khi trả kết quả; không được trả CANCELLED cho yêu cầu hủy mới tại hoặc sau E.
- [ ] AE-16c: Khi không có yêu cầu từ người lái xe và tiến trình hoạt động bình thường, tác vụ nền giải phóng lượt giữ pin trong độ trễ tối đa đã thống nhất sau E. Kiểm tra hành vi phục hồi tiến trình sau sự cố theo thỏa thuận riêng. Ghi nhận đang chờ nếu các giới hạn này chưa được thống nhất.
- [ ] AE-16d: Cho xử lý hủy/hết hạn cạnh tranh quanh E và lặp lại cả hai thao tác. Chỉ một lần chuyển sang trạng thái kết thúc được hoàn lại một pin; tồn kho không bao giờ vượt quá sáu. Thời gian máy chủ tại thời điểm chuyển trạng thái nguyên tử quyết định hủy hay hết hạn.

Thời lượng giữ pin, chu kỳ tiến trình và giới hạn độ trễ giải phóng lấy từ các quyết định ở mục 8 SRS, không tự đặt giá trị. Không giả định tác vụ nền ghi dữ liệu tức thời tại E.

### AE-17 — Xác nhận hết hiệu lực hoặc bị thay đổi

Yêu cầu: FR-06, FR-11, BR-06.

**Cho trước** bản nháp chưa được dùng để tạo đơn của USER-A cho ST-01/FAM_A và mã xác nhận của nó, chưa có yêu cầu chống xử lý trùng tương ứng được ghi nhận thành công trước đó. **Khi** người dùng khác sử dụng, bản nháp hết hạn hoặc trạm/nhóm pin/số lượng/phiên bản thay đổi mà không xác nhận lại. **Thì** từ chối xác nhận hết hiệu lực/không có quyền; không tạo đơn hoặc thay đổi tồn kho A/B. Hiển thị đề xuất mới khi phù hợp.

**Trường hợp con — bản nháp đã dùng:** Xác nhận một bản nháp hợp lệ bằng K1, sau đó gửi lại chính bản nháp đó bằng K2. Trả lỗi xung đột do bản nháp đã được sử dụng, giữ nguyên một đơn và tồn kho A bằng năm. Lặp lại với K1/K2 gửi đồng thời: một yêu cầu tạo đơn, yêu cầu kia nhận lỗi xung đột. Bản nháp không thể tạo thêm đơn sau khi đơn liên kết bị hủy/hết hạn. Gửi lại cùng khóa/nội dung yêu cầu thực hiện theo AE-11. Quy tắc này không cấm các đơn riêng biệt được tạo từ các bản nháp riêng biệt.

### AE-18 — Trạm gần nhất khi tìm kiếm khác trạm gần nhất đủ điều kiện đặt pin

Yêu cầu: FR-02, FR-11, BR-03, BR-04, BR-07.

**Cho trước** vị trí trùng ST-05, SWAPPING/FAM_A và dữ liệu ban đầu. **Khi** tìm kiếm. **Thì** ST-05 đứng đầu ở 0.0 km nhưng không còn pin A. **Khi** yêu cầu đặt tại trạm gần nhất đủ điều kiện. **Thì** chọn **ST-03**, khoảng cách chưa làm tròn 1.161907 km (hiển thị 1.2 km), trước ST-01 ở 1.312928 km. Hiển thị/xác nhận trạm này và kiểm tra lại tồn kho; không đặt tại ST-05 chỉ vì nó gần nhất.

**Trường hợp con — không có trạm đủ điều kiện:** Trong bản sao độc lập, đặt toàn bộ tồn kho pin đổi FAM_A được hỗ trợ về không. Yêu cầu đặt FAM_A tại trạm gần nhất từ LOC-01, không giới hạn bán kính, qua biểu mẫu/dịch vụ dùng chung và hội thoại. Trả kết quả không khả dụng; không tạo bản nháp/đơn và không đổi nhóm pin. Tìm kiếm vẫn hiển thị các trạm tương thích với trạng thái hết pin. Đồng thời kiểm tra dữ liệu ban đầu với bán kính 0.5 km từ ST-05 (mô phỏng pin hiện tại chỉ còn đi được 0.5 km): ST-03 (1.2 km) bị loại vì vượt quá tầm với của pin, không âm thầm mở rộng bán kính/phạm vi pin để chọn ST-03 và trả kết quả không khả dụng. Sau đó khôi phục dữ liệu ban đầu.

### AE-19 — Hai yêu cầu tiếng Việt mục tiêu

Yêu cầu: FR-10, FR-11, BR-02, BR-06.

**Cho trước** USER-A, FAM_A và vị trí trùng ST-02. **Khi** nói “tìm giúp tôi trạm sạc gần tôi nhất”. **Thì** tìm kiếm trạm sạc phía máy chủ có thể trả ST-02 ở 0.0 km. **Khi** tiếp tục nói “đặt giúp tôi 1 pin ở trạm gần nhất”. **Thì** tìm trạm đổi pin phù hợp (ST-03 theo dữ liệu ban đầu), hiển thị và yêu cầu xác nhận; không đặt tại ST-02 chỉ có sạc. Nếu chưa biết vị trí/nhóm pin, phải hỏi trước thay vì tự tạo thông tin.

### AE-20 — Công cụ không được tự tạo dữ liệu làm căn cứ

Yêu cầu: FR-05, FR-10, FR-11, BR-10.

**Cho trước** văn bản người dùng/mô hình đề xuất trạm không tồn tại hoặc nói “bỏ qua kiểm tra tồn kho”. **Khi** lớp kiểm soát công cụ nhận nội dung đó. **Thì** xác thực/từ chối tham số không hợp lệ hoặc thực hiện các quy tắc kiểm tra thông thường; không chạy SQL tùy ý, chấp nhận tồn kho bịa đặt hoặc bỏ qua quyền sở hữu. Chỉ hiển thị thành công khi phản hồi thành công thực sự từ máy chủ chứa mã đơn. Sprint 1 ghi nhận kết quả thử nghiệm kỹ thuật; hành vi hội thoại hoàn chỉnh được nghiệm thu trong Sprint 3.

### AE-21 — Lỗi LLM/công cụ và chưa rõ kết quả thay đổi dữ liệu

Yêu cầu: FR-12, NFR-02, BR-08.

**Cho trước** nhà cung cấp/công cụ hết thời gian chờ hoặc gặp lỗi. **Khi** yêu cầu chỉ đọc dữ liệu. **Thì** giải thích lỗi và cho phép thử lại/chuyển sang biểu mẫu, không hiển thị kết quả trạm bịa đặt. **Khi** xác nhận có thể đã được ghi nhận thành công. **Thì** giữ trạng thái chưa rõ kết quả và đối soát bằng cùng khóa chống xử lý trùng/truy vấn đơn đã được xác thực quyền; không tự động gửi đặt pin với khóa mới hoặc khẳng định chưa có đơn.

### AE-22 — Đặt lại dữ liệu mẫu độc lập và tái lập được

Yêu cầu: FR-13, NFR-07.

**Cho trước** công cụ đặt lại dữ liệu sẽ được xây dựng trong môi trường phát triển/kiểm thử. **Khi** gọi công cụ mà không có quyền/không xác nhận rõ thao tác xóa dữ liệu, hoặc chạy với môi trường không phải thử nghiệm. **Thì** công cụ phải từ chối. **Khi** được cho phép rõ ràng đối với bộ dữ liệu thử nghiệm độc lập. **Thì** công cụ có thể tái lập 18 bản ghi đã mô tả, với danh sách đơn/bản nháp ban đầu rỗng. Đây là yêu cầu cho triển khai sau này, không phải chương trình được bàn giao trong task 1.1.1.

### AE-23 — Khóa truy cập, quyền riêng tư và thao tác bàn phím

Yêu cầu: NFR-03, NFR-04, NFR-05, BR-01.

Áp dụng từng phép kiểm tra ngay từ phiên bản gia tăng đầu tiên có tính năng liên quan, sau đó lặp lại trên bản tích hợp Sprint 3. Ghi bằng chứng đạt/không đạt/đang chờ riêng biệt; mục chưa kiểm tra không được tính là đạt.

- [ ] AE-23a: Không có thông tin bí mật của nhà cung cấp/máy chủ trong mã nguồn, đầu ra phía trình duyệt hoặc nhật ký.
- [ ] AE-23b: Giới hạn nguồn truy cập/API của khóa Maps phía trình duyệt được kiểm tra riêng với việc nạp biến môi trường.
- [ ] AE-23c: Các trường vị trí/hội thoại được lưu, quyền truy cập và hành vi xóa phù hợp chính sách quyền riêng tư đã thống nhất; không ghi nhật ký vị trí chính xác/nội dung hội thoại không cần thiết.
- [ ] AE-23d: Các điều khiển chính để tìm kiếm, xác nhận và quản lý đơn sử dụng được bằng bàn phím ngay khi được cung cấp; thêm điều khiển hội thoại trong Sprint 3.
- [ ] AE-23e: Nhãn, lỗi và thông báo dữ liệu giả lập vẫn đọc được ở từng kích thước vùng hiển thị máy tính/điện thoại đã thống nhất.
- [ ] AE-23f: Tạo phiên, quyền sở hữu, hết hạn/khôi phục phiên và các biện pháp bảo vệ phiên áp dụng phải tuân thủ đặc tả đã thống nhất; phiên hết hạn không thể cho phép thay đổi dữ liệu hoặc tiết lộ đơn.

Dùng các mốc quyết định ở mục 8 SRS cho chính sách/kích thước vùng hiển thị/phiên chưa chốt. Ghi nhận quyết định còn thiếu là đang chờ, không tự suy ra đã nghiệm thu.

### AE-24 — Đo hiệu năng, không đưa ra cam kết thiếu căn cứ

Yêu cầu: NFR-06, NFR-08.

**Cho trước** bản có thể chạy được xây dựng sau này và bộ dữ liệu 18 bản ghi. **Khi** đo tìm kiếm phía máy chủ riêng với hoạt động Maps/LLM bên ngoài. **Thì** ghi môi trường, cỡ mẫu, trung vị/p95 và các lỗi. Dùng phương pháp đo và ngưỡng đã thống nhất qua mục 8 SRS; ghi đạt/không đạt theo các mục tiêu đó hoặc đang chờ nếu chưa thống nhất. Ghi độ bao phủ kiểm thử riêng theo chỉ số/phạm vi/phần loại trừ đã thống nhất; riêng ví dụ này không chứng minh độ bao phủ >=80%. Bộ yêu cầu không có độ trễ đã đo, cam kết 300 ms, kiểm thử đã triển khai hoặc kết quả độ bao phủ được khẳng định.

## Rà soát và bàn giao để triển khai

Tất cả ví dụ là đầu vào nghiệm thu được đề xuất. M2/M4 phải xác nhận ý nghĩa trường dữ liệu/lỗi/phiên/giá trị thời hạn; M3/M5 rà soát điều khiển và câu chữ; M6 dùng cùng lớp kiểm soát phía máy chủ; M7 chuyển các ví dụ thành kiểm thử đơn vị/tích hợp/toàn trình và ghi bằng chứng sau này. Các công việc sau này của M1 về chỉ dẫn cho mô hình/cấu trúc JSON và chương trình nạp/đặt lại dữ liệu được mô tả trong kế hoạch/danh sách công việc, chưa được triển khai tại đây.
