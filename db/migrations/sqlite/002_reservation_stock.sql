-- SQLite replaces the table to change its foreign keys; preserve historic drafts and orders.
PRAGMA foreign_keys = OFF;
BEGIN;
DROP VIEW v_reservation_detail;
CREATE TABLE reservation_draft_new (
    draft_id    UUID        NOT NULL,
    user_id     VARCHAR(20) NOT NULL,
    station_id  VARCHAR(10) NOT NULL,
    family_code VARCHAR(10) NOT NULL,
    quantity    INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_reservation_draft PRIMARY KEY (draft_id),
    CONSTRAINT fk_draft_user FOREIGN KEY (user_id) REFERENCES app_user (user_id),
    CONSTRAINT fk_draft_station FOREIGN KEY (station_id) REFERENCES station (station_id),
    CONSTRAINT fk_draft_family FOREIGN KEY (family_code) REFERENCES battery_family (family_code),
    CONSTRAINT ck_draft_quantity CHECK (quantity = 1),
    CONSTRAINT ck_draft_window CHECK (expires_at > created_at)
);
INSERT INTO reservation_draft_new (draft_id, user_id, station_id, family_code, quantity, created_at, expires_at)
SELECT draft_id, user_id, station_id, family_code, quantity, created_at, expires_at FROM reservation_draft;
DROP TABLE reservation_draft;
ALTER TABLE reservation_draft_new RENAME TO reservation_draft;
CREATE INDEX ix_draft_user ON reservation_draft (user_id);
CREATE INDEX ix_draft_station_family ON reservation_draft (station_id, family_code);

CREATE VIEW v_reservation_detail AS
    SELECT r.reservation_id, d.user_id, d.station_id, d.family_code, d.quantity,
           r.status, r.created_at, r.expires_at, r.cancelled_at, r.expired_at, r.draft_id
    FROM reservation r
    JOIN reservation_draft d ON d.draft_id = r.draft_id;

CREATE TRIGGER protect_active_stock_delete
BEFORE DELETE ON station_battery_stock
WHEN EXISTS (
    SELECT 1 FROM reservation_draft d JOIN reservation r USING (draft_id)
    WHERE d.station_id = OLD.station_id AND d.family_code = OLD.family_code AND r.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'Stock row is required by an active reservation');
END;

CREATE TRIGGER protect_active_stock_key_update
BEFORE UPDATE OF station_id, family_code ON station_battery_stock
WHEN (OLD.station_id <> NEW.station_id OR OLD.family_code <> NEW.family_code) AND EXISTS (
    SELECT 1 FROM reservation_draft d JOIN reservation r USING (draft_id)
    WHERE d.station_id = OLD.station_id AND d.family_code = OLD.family_code AND r.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'Stock row is required by an active reservation');
END;

COMMIT;
PRAGMA foreign_keys = ON;
