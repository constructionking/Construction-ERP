-- AlterTable
ALTER TABLE "measurement_books" ADD COLUMN     "aiRemarks" JSONB;

-- aiRemarks is a system-managed advisory field: exempt it from the
-- immutability comparison alongside parseStatus/rowErrors.
DROP TRIGGER trg_append_only_mb ON measurement_books;
CREATE TRIGGER trg_append_only_mb
  BEFORE UPDATE OR DELETE ON measurement_books
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('parseStatus', 'rowErrors', 'aiRemarks');
