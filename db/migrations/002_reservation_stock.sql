BEGIN;

-- Drafts record the user's choice even when the station subsequently changes its services.
ALTER TABLE reservation_draft
    DROP CONSTRAINT fk_draft_battery_stock,
    ADD CONSTRAINT fk_draft_station FOREIGN KEY (station_id) REFERENCES station (station_id),
    ADD CONSTRAINT fk_draft_family FOREIGN KEY (family_code) REFERENCES battery_family (family_code);

-- Confirmation locks/updates the stock row before inserting an ACTIVE order in the same
-- transaction. A competing DELETE/key update waits there, then checks committed orders.
CREATE FUNCTION protect_active_reservation_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.station_id, OLD.family_code) = (NEW.station_id, NEW.family_code) THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM reservation_draft d JOIN reservation r USING (draft_id)
        WHERE d.station_id = OLD.station_id AND d.family_code = OLD.family_code AND r.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Stock row is required by an active reservation' USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_active_stock
BEFORE DELETE OR UPDATE OF station_id, family_code ON station_battery_stock
FOR EACH ROW EXECUTE FUNCTION protect_active_reservation_stock();

COMMIT;
