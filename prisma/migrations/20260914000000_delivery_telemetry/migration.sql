-- Delivery telemetry: what the camera/AI estimated a delivery to be, stored
-- BESIDE the engineer's receipt quantity (never overwriting it). A large gap
-- raises an audit flag for the owner.
ALTER TYPE "AuditRule" ADD VALUE 'ai_receipt_discrepancy';

CREATE TABLE "delivery_estimates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "kind" TEXT NOT NULL,            -- steel_count | scan_volume
    "source" TEXT NOT NULL,          -- ai | manual | scan
    "photoIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "scanId" UUID,
    "count" INTEGER,
    "diameterMm" DECIMAL(6,2),
    "lengthM" DECIMAL(6,2),
    "estimatedQty" DECIMAL(14,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "confidence" DECIMAL(4,3),
    "rationale" TEXT,
    "model" TEXT,
    "receiptEntityId" UUID,
    "flagId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_estimates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delivery_estimates_siteId_createdAt_idx" ON "delivery_estimates"("siteId", "createdAt");

-- The estimate the engineer checked the receipt against (nullable, additive;
-- append-only triggers on submitted rows are untouched).
ALTER TABLE "material_receipts" ADD COLUMN "estimateId" UUID;
