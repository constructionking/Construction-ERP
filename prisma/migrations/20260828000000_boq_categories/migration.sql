-- BOQ import: work types visible on Indian BOQs that were missing from the
-- category enum. Values-only migration: ALTER TYPE ... ADD VALUE cannot be
-- combined with statements that USE the new values in the same transaction.
ALTER TYPE "ActivityCategory" ADD VALUE 'reinforcement';
ALTER TYPE "ActivityCategory" ADD VALUE 'shuttering';
