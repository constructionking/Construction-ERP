-- Per-main-activity start anchor: a structure (isGroup row) can carry its own
-- start date; the schedule model chains its items from this day instead of the
-- project start. NULL = fall back to the site's startDate.
ALTER TABLE "activities" ADD COLUMN "startDate" DATE;
