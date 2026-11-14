-- Vinergy — lược đồ cơ sở dữ liệu v0.1 (BẢN NHÁP, chờ M2/M4 rà soát)
-- Tài liệu thiết kế: docs/design/Database_Design.md
-- DBMS mục tiêu: PostgreSQL 14+. Chỉ dùng cú pháp SQL chuẩn để cũng chạy được trên SQLite
-- (nhớ bật PRAGMA foreign_keys = ON) cho kiểm thử cục bộ.
-- Tệp này chỉ TẠO cấu trúc trên cơ sở dữ liệu trống; không DROP/TRUNCATE (FR-13).

-- ---------------------------------------------------------------------------
-- 1. Dữ liệu tham chiếu
-- ---------------------------------------------------------------------------

-- BR-01: chỉ có hai nhóm xe/pin giả lập.
CREATE TABLE battery_family (
    family_code     VARCHAR(10)  NOT NULL,
    label           VARCHAR(100) NOT NULL,
    demo_vehicle_id VARCHAR(20)  NOT NULL,
    CONSTRAINT pk_battery_family PRIMARY KEY (family_code),
    CONSTRAINT uq_battery_family_vehicle UNIQUE (demo_vehicle_id),
    CONSTRAINT ck_battery_family_code CHECK (family_code IN ('FAM_A', 'FAM_B'))
);

-- Người dùng demo. Danh tính được xác lập bằng phiên phía máy chủ (BR-10).
CREATE TABLE app_user (
    user_id    VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_app_user PRIMARY KEY (user_id)
);

-- TẠM THỜI: thiết kế phiên còn chờ quyết định ở WBS 1.1.2 (SRS mục 8).
-- Chỉ lưu giá trị băm của token phiên, không lưu token gốc (NFR-03/NFR-04).
CREATE TABLE user_session (
    session_token_hash CHAR(64)    NOT NULL,
    user_id            VARCHAR(20) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at         TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ,
    CONSTRAINT pk_user_session PRIMARY KEY (session_token_hash),
    CONSTRAINT fk_user_session_user FOREIGN KEY (user_id) REFERENCES app_user (user_id),
    CONSTRAINT ck_user_session_window CHECK (expires_at > created_at)
);

-- Vị trí mẫu LOC-01..LOC-03 dùng cho nhập thủ công/kiểm thử; không có quan hệ với bảng khác.
CREATE TABLE demo_origin (
    origin_id VARCHAR(10)  NOT NULL,
    lat       NUMERIC(8, 6) NOT NULL,
    lng       NUMERIC(9, 6) NOT NULL,
    CONSTRAINT pk_demo_origin PRIMARY KEY (origin_id),
    CONSTRAINT ck_demo_origin_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_demo_origin_lng CHECK (lng BETWEEN -180 AND 180)
);

-- ---------------------------------------------------------------------------
-- 2. Trạm và tài nguyên mô phỏng
-- ---------------------------------------------------------------------------

-- station_id cố định dạng 'ST-nn' để thứ tự chuỗi trùng thứ tự số khi khoảng cách bằng nhau (BR-04).
-- Trên PostgreSQL, sắp xếp bằng ORDER BY ..., station_id COLLATE "C" để kết quả xác định.
CREATE TABLE station (
    station_id     VARCHAR(10)   NOT NULL,
    name           VARCHAR(100)  NOT NULL,
    area_label     VARCHAR(100)  NOT NULL,
    lat            NUMERIC(8, 6) NOT NULL,
    lng            NUMERIC(9, 6) NOT NULL,
    opening_status VARCHAR(12)   NOT NULL,
    CONSTRAINT pk_station PRIMARY KEY (station_id),
    CONSTRAINT ck_station_id_format CHECK (station_id LIKE 'ST-__'),
    CONSTRAINT ck_station_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_station_lng CHECK (lng BETWEEN -180 AND 180),
    CONSTRAINT ck_station_status CHECK (opening_status IN ('OPEN', 'CLOSED', 'MAINTENANCE'))
);

-- Dịch vụ SWAPPING. Có dòng = trạm hỗ trợ đổi pin cho nhóm đó (BR-03);
-- available_batteries = 0 nghĩa là "được hỗ trợ nhưng hết pin", khác với không có dòng.
-- CHECK >= 0 là chốt chặn cuối cùng chống tồn kho âm (NFR-01, AE-13).
CREATE TABLE station_battery_stock (
    station_id          VARCHAR(10) NOT NULL,
    family_code         VARCHAR(10) NOT NULL,
    available_batteries INTEGER     NOT NULL,
    CONSTRAINT pk_station_battery_stock PRIMARY KEY (station_id, family_code),
    CONSTRAINT fk_battery_stock_station FOREIGN KEY (station_id) REFERENCES station (station_id),
    CONSTRAINT fk_battery_stock_family FOREIGN KEY (family_code) REFERENCES battery_family (family_code),
    CONSTRAINT ck_battery_stock_nonneg CHECK (available_batteries >= 0)
);

-- Dịch vụ CHARGING. Chỉ phục vụ tìm kiếm (BR-02); không bảng nào khác tham chiếu tới,
-- nên việc đặt pin không thể làm thay đổi số cổng sạc.
CREATE TABLE station_charging_port (
    station_id      VARCHAR(10) NOT NULL,
    family_code     VARCHAR(10) NOT NULL,
    available_ports INTEGER     NOT NULL,
    CONSTRAINT pk_station_charging_port PRIMARY KEY (station_id, family_code),
    CONSTRAINT fk_charging_port_station FOREIGN KEY (station_id) REFERENCES station (station_id),
    CONSTRAINT fk_charging_port_family FOREIGN KEY (family_code) REFERENCES battery_family (family_code),
    CONSTRAINT ck_charging_port_nonneg CHECK (available_ports >= 0)
);

-- ---------------------------------------------------------------------------
-- 3. Vòng đời đặt pin (Sprint 2)
-- ---------------------------------------------------------------------------

-- Bản nháp không giữ tồn kho (BR-06) và bất biến sau khi tạo: đổi trạm/nhóm = tạo bản nháp mới.
-- Khóa ngoại kép tới station_battery_stock bảo đảm chỉ nháp được ở trạm SWAPPING hỗ trợ đúng nhóm (BR-02).
-- Thời hạn do máy chủ cấu hình (quyết định còn mở), nên không đặt DEFAULT cho expires_at.
CREATE TABLE reservation_draft (
    draft_id    UUID        NOT NULL,
    user_id     VARCHAR(20) NOT NULL,
    station_id  VARCHAR(10) NOT NULL,
    family_code VARCHAR(10) NOT NULL,
    quantity    INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_reservation_draft PRIMARY KEY (draft_id),
    CONSTRAINT fk_draft_user FOREIGN KEY (user_id) REFERENCES app_user (user_id),
    CONSTRAINT fk_draft_battery_stock FOREIGN KEY (station_id, family_code)
        REFERENCES station_battery_stock (station_id, family_code),
    CONSTRAINT ck_draft_quantity CHECK (quantity = 1),
    CONSTRAINT ck_draft_window CHECK (expires_at > created_at)
);

-- UNIQUE(draft_id): mỗi bản nháp tạo tối đa một đơn, kể cả khi xác nhận đồng thời bằng khóa khác nhau (BR-06).
-- Chủ sở hữu/trạm/nhóm/số lượng lấy qua draft_id, không sao chép lại.
-- Các CHECK mã hóa BR-09: CANCELLED chỉ hợp lệ khi hủy trước hạn; EXPIRED chỉ từ thời điểm hết hạn trở đi.
CREATE TABLE reservation (
    reservation_id UUID        NOT NULL,
    draft_id       UUID        NOT NULL,
    status         VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     TIMESTAMPTZ NOT NULL,
    cancelled_at   TIMESTAMPTZ,
    expired_at     TIMESTAMPTZ,
    CONSTRAINT pk_reservation PRIMARY KEY (reservation_id),
    CONSTRAINT uq_reservation_draft UNIQUE (draft_id),
    CONSTRAINT fk_reservation_draft FOREIGN KEY (draft_id) REFERENCES reservation_draft (draft_id),
    CONSTRAINT ck_reservation_window CHECK (expires_at > created_at),
    CONSTRAINT ck_reservation_state CHECK (
        (status = 'ACTIVE'    AND cancelled_at IS NULL AND expired_at IS NULL)
     OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND expired_at IS NULL
                              AND cancelled_at < expires_at)
     OR (status = 'EXPIRED'   AND expired_at IS NOT NULL AND cancelled_at IS NULL
                              AND expired_at >= expires_at)
    )
);

-- Chống xử lý lặp, phạm vi (người dùng, thao tác, khóa) theo BR-08.
-- Bản ghi được chèn trong CÙNG giao dịch tạo đơn, nên chỉ tồn tại cho yêu cầu đã thành công.
-- request_hash: SHA-256 của nội dung yêu cầu chuẩn hóa; khác hash dưới cùng khóa = xung đột (AE-12).
CREATE TABLE idempotency_record (
    user_id         VARCHAR(20)  NOT NULL,
    operation       VARCHAR(30)  NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_hash    CHAR(64)     NOT NULL,
    reservation_id  UUID         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_idempotency_record PRIMARY KEY (user_id, operation, idempotency_key),
    CONSTRAINT uq_idempotency_reservation UNIQUE (operation, reservation_id),
    CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES app_user (user_id),
    CONSTRAINT fk_idempotency_reservation FOREIGN KEY (reservation_id) REFERENCES reservation (reservation_id),
    CONSTRAINT ck_idempotency_operation CHECK (operation IN ('CONFIRM_RESERVATION'))
);

-- ---------------------------------------------------------------------------
-- 4. Chỉ mục
-- ---------------------------------------------------------------------------

CREATE INDEX ix_draft_user ON reservation_draft (user_id);
CREATE INDEX ix_draft_station_family ON reservation_draft (station_id, family_code);
CREATE INDEX ix_user_session_user ON user_session (user_id);
-- Tác vụ nền quét các đơn ACTIVE đã quá hạn (BR-09).
CREATE INDEX ix_reservation_active_expiry ON reservation (expires_at) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 5. Khung nhìn (dữ liệu suy diễn, không lưu trữ)
-- ---------------------------------------------------------------------------

-- Tương đương các trường services / supported_families / *_by_family của tệp JSON.
CREATE VIEW v_station_resource AS
    SELECT station_id, 'SWAPPING' AS service_type, family_code, available_batteries AS available_count
    FROM station_battery_stock
    UNION ALL
    SELECT station_id, 'CHARGING' AS service_type, family_code, available_ports AS available_count
    FROM station_charging_port;

-- Đơn kèm chủ sở hữu/trạm/nhóm/số lượng lấy từ bản nháp (SRS mục 6, "Đơn đặt pin").
CREATE VIEW v_reservation_detail AS
    SELECT r.reservation_id, d.user_id, d.station_id, d.family_code, d.quantity,
           r.status, r.created_at, r.expires_at, r.cancelled_at, r.expired_at, r.draft_id
    FROM reservation r
    JOIN reservation_draft d ON d.draft_id = r.draft_id;
