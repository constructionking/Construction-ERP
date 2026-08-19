-- Append-only enforcement at the DATABASE level.
-- App code goes through src/lib/versioning/amend.ts, but even raw SQL cannot
-- mutate submitted business data: these triggers reject it.

-- ---------------------------------------------------------------------------
-- 1. Versioned tables: draft rows are free; submitted rows may only flip
--    isCurrent/status to superseded; superseded rows are frozen solid.
--    Extra trigger args name system columns exempt from the immutability
--    comparison (e.g. async parse status on measurement books).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_append_only() RETURNS trigger AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  exempt text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'append_only: cannot delete a % record from %', OLD.status, TG_TABLE_NAME;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  old_j := to_jsonb(OLD) - 'isCurrent' - 'status';
  new_j := to_jsonb(NEW) - 'isCurrent' - 'status';
  IF TG_NARGS > 0 THEN
    FOREACH exempt IN ARRAY TG_ARGV LOOP
      old_j := old_j - exempt;
      new_j := new_j - exempt;
    END LOOP;
  END IF;

  IF old_j <> new_j THEN
    RAISE EXCEPTION 'append_only: % rows in % are immutable — amend via a new version',
      OLD.status, TG_TABLE_NAME;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status NOT IN ('submitted', 'superseded') THEN
    RAISE EXCEPTION 'append_only: submitted rows may only move to superseded';
  END IF;

  IF OLD.status = 'superseded'
     AND (NEW.status <> 'superseded' OR NEW."isCurrent" IS DISTINCT FROM OLD."isCurrent") THEN
    RAISE EXCEPTION 'append_only: superseded rows are frozen';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_append_only_progress
  BEFORE UPDATE OR DELETE ON progress_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

CREATE TRIGGER trg_append_only_mb
  BEFORE UPDATE OR DELETE ON measurement_books
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('parseStatus', 'rowErrors');

CREATE TRIGGER trg_append_only_receipt
  BEFORE UPDATE OR DELETE ON material_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

CREATE TRIGGER trg_append_only_consumption
  BEFORE UPDATE OR DELETE ON consumption_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

CREATE TRIGGER trg_append_only_requisition
  BEFORE UPDATE OR DELETE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

CREATE TRIGGER trg_append_only_labour
  BEFORE UPDATE OR DELETE ON labour_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- One current version per logical record.
CREATE UNIQUE INDEX uq_progress_current ON progress_entries ("entityId") WHERE "isCurrent";
CREATE UNIQUE INDEX uq_mb_current ON measurement_books ("entityId") WHERE "isCurrent";
CREATE UNIQUE INDEX uq_receipt_current ON material_receipts ("entityId") WHERE "isCurrent";
CREATE UNIQUE INDEX uq_consumption_current ON consumption_entries ("entityId") WHERE "isCurrent";
CREATE UNIQUE INDEX uq_requisition_current ON requisitions ("entityId") WHERE "isCurrent";
CREATE UNIQUE INDEX uq_labour_current ON labour_entries ("entityId") WHERE "isCurrent";

-- ---------------------------------------------------------------------------
-- 2. Fully frozen tables: INSERT once, never UPDATE or DELETE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable: % does not allow % — corrections are new rows',
    TG_TABLE_NAME, TG_OP;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_frozen_baselines
  BEFORE UPDATE OR DELETE ON baselines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_baseline_activities
  BEFORE UPDATE OR DELETE ON baseline_activities
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_scan_decisions
  BEFORE UPDATE OR DELETE ON scan_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_scan_results
  BEFORE UPDATE OR DELETE ON scan_results
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_approval_actions
  BEFORE UPDATE OR DELETE ON approval_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_edit_log
  BEFORE UPDATE OR DELETE ON edit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_labour_closures
  BEFORE UPDATE OR DELETE ON labour_period_closures
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_benchmark_rates
  BEFORE UPDATE OR DELETE ON benchmark_rates
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_day_closes
  BEFORE UPDATE OR DELETE ON day_closes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_frozen_mb_lines
  BEFORE UPDATE OR DELETE ON mb_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. Photos: evidentiary. Never deleted; the ONLY permitted update is filling
--    the supersede fields (once) — a wrong photo is answered by a new photo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_photo_supersede() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable: photos cannot be deleted — supersede with a reason instead';
  END IF;

  IF (to_jsonb(OLD) - 'supersededReason' - 'supersededById' - 'supersededAt')
     <> (to_jsonb(NEW) - 'supersededReason' - 'supersededById' - 'supersededAt') THEN
    RAISE EXCEPTION 'immutable: photo data cannot change — only supersede fields may be set';
  END IF;

  IF OLD."supersededAt" IS NOT NULL THEN
    RAISE EXCEPTION 'immutable: photo is already superseded';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_photo_supersede
  BEFORE UPDATE OR DELETE ON photos
  FOR EACH ROW EXECUTE FUNCTION enforce_photo_supersede();
