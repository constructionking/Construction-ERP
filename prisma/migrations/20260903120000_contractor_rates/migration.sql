-- Contractor-wise rate cards: each contractor has their own negotiated rates.
-- A rate row is either tied to a work item (sub-activity of an assigned main
-- activity) or free-form (description + unit) — a rate locked today for
-- future work not yet in the BOQ.
CREATE TABLE "contractors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contractors_siteId_name_key" ON "contractors"("siteId", "name");

CREATE TABLE "contractor_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contractorId" UUID NOT NULL,
    "activityId" UUID,
    "description" TEXT,
    "unit" "Unit",
    "rate" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contractor_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contractor_rates_contractorId_activityId_key" ON "contractor_rates"("contractorId", "activityId");

ALTER TABLE "contractor_rates" ADD CONSTRAINT "contractor_rates_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assigned contractor on an activity (contractorName stays the synced legacy string).
ALTER TABLE "activities" ADD COLUMN "contractorId" UUID;
