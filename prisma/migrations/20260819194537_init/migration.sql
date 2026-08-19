-- CreateEnum
CREATE TYPE "Role" AS ENUM ('engineer', 'accounts', 'purchase', 'billing_engineer');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('draft', 'submitted', 'superseded');

-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('progress_entry', 'measurement_book', 'material_receipt', 'consumption_entry', 'requisition', 'labour_entry');

-- CreateEnum
CREATE TYPE "AmendmentWindow" AS ENUM ('until_day_close', 'until_actioned', 'same_day', 'never');

-- CreateEnum
CREATE TYPE "AmendmentActor" AS ENUM ('author', 'owner');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('CUM', 'SQM', 'MTR', 'BAG', 'NOS', 'KG', 'TON');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('active', 'on_hold', 'completed');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('earthwork', 'concreting', 'masonry', 'plaster', 'waterproofing', 'flooring', 'finishes', 'external', 'general');

-- CreateEnum
CREATE TYPE "ExecutorType" AS ENUM ('dept', 'contractor');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('progress', 'receipt', 'scan_frame');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('pending', 'parsed', 'failed');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('cement', 'sand', 'aggregate', 'brick', 'steel', 'other');

-- CreateEnum
CREATE TYPE "ScanMethod" AS ENUM ('photogrammetry', 'lidar', 'template');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('capturing', 'queued', 'processing', 'computed', 'accepted', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ScanDecisionType" AS ENUM ('accepted', 'rejected');

-- CreateEnum
CREATE TYPE "RequisitionKind" AS ENUM ('material', 'fund');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('approved', 'partially_approved', 'rejected', 'queried', 'queued');

-- CreateEnum
CREATE TYPE "LabourEntryType" AS ENUM ('day_rate', 'period');

-- CreateEnum
CREATE TYPE "LabourSource" AS ENUM ('morning_market', 'contractor');

-- CreateEnum
CREATE TYPE "RateBasis" AS ENUM ('per_day', 'per_unit');

-- CreateEnum
CREATE TYPE "AuditRule" AS ENUM ('consumption_variance', 'labour_cost_over_benchmark', 'contractor_delay', 'scan_variance', 'receipt_requisition_mismatch', 'ai_progress_discrepancy');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('info', 'warn', 'critical');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "site_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "location" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "startDate" DATE,
    "status" "SiteStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "category" "ActivityCategory" NOT NULL DEFAULT 'general',
    "boqQty" DECIMAL(14,3),
    "unit" "Unit",
    "productivityNormQtyPerDay" DECIMAL(14,3),
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "contractorName" TEXT,
    "boqRate" DECIMAL(14,2),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_dependencies" (
    "id" UUID NOT NULL,
    "predecessorId" UUID NOT NULL,
    "successorId" UUID NOT NULL,
    "lagDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "activity_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_suggestions" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "params" JSONB NOT NULL,

    CONSTRAINT "schedule_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggested_dates" (
    "id" UUID NOT NULL,
    "suggestionId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "suggStart" DATE NOT NULL,
    "suggEnd" DATE NOT NULL,
    "monsoonAffected" BOOLEAN NOT NULL DEFAULT false,
    "multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,

    CONSTRAINT "suggested_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "lockedById" UUID NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_activities" (
    "id" UUID NOT NULL,
    "baselineId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "plannedStart" DATE NOT NULL,
    "plannedEnd" DATE NOT NULL,
    "plannedQty" DECIMAL(14,3),

    CONSTRAINT "baseline_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_forecasts" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "forecastEnd" DATE,
    "slipPct" DECIMAL(7,2),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_entries" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "qtyDone" DECIMAL(14,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "executedBy" "ExecutorType" NOT NULL,
    "contractorName" TEXT,
    "notes" TEXT,

    CONSTRAINT "progress_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "activityId" UUID,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "takenAt" TIMESTAMP(3),
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "geoAccuracy" DOUBLE PRECISION,
    "uploadedById" UUID NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "supersededReason" TEXT,
    "supersededById" UUID,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_progress_estimates" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "photoIds" UUID[],
    "estimatePct" DECIMAL(5,2) NOT NULL,
    "model" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagId" UUID,

    CONSTRAINT "ai_progress_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_books" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "mbDate" DATE NOT NULL,
    "sheetNo" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'pending',
    "rowErrors" JSONB,

    CONSTRAINT "measurement_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mb_lines" (
    "id" UUID NOT NULL,
    "measurementBookId" UUID NOT NULL,
    "srNo" INTEGER NOT NULL,
    "lineDate" DATE NOT NULL,
    "activityCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "nos" DECIMAL(14,3) NOT NULL,
    "length" DECIMAL(14,3),
    "breadth" DECIMAL(14,3),
    "depth" DECIMAL(14,3),
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "executedBy" TEXT NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "mb_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "category" "MaterialCategory" NOT NULL,
    "spec" TEXT,
    "densityKgPerCum" DECIMAL(10,2),
    "unitsPerCum" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mix_designs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputUnit" "Unit" NOT NULL DEFAULT 'CUM',

    CONSTRAINT "mix_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mix_design_coefficients" (
    "id" UUID NOT NULL,
    "mixId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "qtyPerUnit" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "mix_design_coefficients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_receipts" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "supplier" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "qualityAdequate" BOOLEAN NOT NULL,
    "qualityRemarks" TEXT,
    "photoIds" UUID[],
    "requisitionEntityId" UUID,
    "receivedDate" DATE NOT NULL,

    CONSTRAINT "material_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_entries" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "mixDesignId" UUID,
    "qty" DECIMAL(14,3) NOT NULL,
    "entryDate" DATE NOT NULL,

    CONSTRAINT "consumption_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stockpile_scans" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "method" "ScanMethod" NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'capturing',
    "markerSizeMm" INTEGER,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stockpile_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_frames" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "scan_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'queued',
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_results" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "computedVolumeCum" DECIMAL(12,3),
    "computedQty" DECIMAL(14,3),
    "qtyUnit" "Unit" NOT NULL,
    "confidence" DECIMAL(4,3),
    "methodUsed" "ScanMethod" NOT NULL,
    "markerDetected" BOOLEAN NOT NULL DEFAULT false,
    "registeredFrames" INTEGER NOT NULL DEFAULT 0,
    "meshStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_decisions" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "decision" "ScanDecisionType" NOT NULL,
    "engineerQty" DECIMAL(14,3),
    "variancePct" DECIMAL(7,2),
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisitions" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "kind" "RequisitionKind" NOT NULL,
    "lines" JSONB NOT NULL,
    "amountTotal" DECIMAL(14,2),
    "neededBy" DATE,
    "justification" TEXT NOT NULL,

    CONSTRAINT "requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL,
    "requisitionEntityId" UUID NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "reason" TEXT,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "defaultUnit" "Unit" NOT NULL,

    CONSTRAINT "work_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labour_entries" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "amendedFromId" UUID,
    "siteId" UUID NOT NULL,
    "entryType" "LabourEntryType" NOT NULL,
    "source" "LabourSource" NOT NULL,
    "contractorName" TEXT,
    "workTypeId" UUID NOT NULL,
    "workersCount" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "rateBasis" "RateBasis" NOT NULL,
    "outputQty" DECIMAL(14,3),
    "outputUnit" "Unit",
    "entryDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,

    CONSTRAINT "labour_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labour_period_closures" (
    "id" UUID NOT NULL,
    "labourEntityId" UUID NOT NULL,
    "closedOn" DATE NOT NULL,
    "finalOutputQty" DECIMAL(14,3) NOT NULL,
    "closedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labour_period_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_rates" (
    "id" UUID NOT NULL,
    "workTypeId" UUID NOT NULL,
    "unit" "Unit" NOT NULL,
    "benchmarkCostPerUnit" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "setById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_flags" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "rule" "AuditRule" NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'open',
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "flagId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edit_log" (
    "id" UUID NOT NULL,
    "entityType" "RecordType" NOT NULL,
    "entityId" UUID NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amendment_policies" (
    "id" UUID NOT NULL,
    "recordType" "RecordType" NOT NULL,
    "allowedWindow" "AmendmentWindow" NOT NULL,
    "allowedActor" "AmendmentActor" NOT NULL DEFAULT 'author',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amendment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closes" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" UUID,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "site_roles_siteId_idx" ON "site_roles"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "site_roles_userId_siteId_key" ON "site_roles"("userId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "sites"("code");

-- CreateIndex
CREATE INDEX "activities_siteId_sequence_idx" ON "activities"("siteId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "activities_siteId_code_key" ON "activities"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "activity_dependencies_predecessorId_successorId_key" ON "activity_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "schedule_suggestions_siteId_generatedAt_idx" ON "schedule_suggestions"("siteId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "suggested_dates_suggestionId_activityId_key" ON "suggested_dates"("suggestionId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_siteId_version_key" ON "baselines"("siteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_activities_baselineId_activityId_key" ON "baseline_activities"("baselineId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_forecasts_activityId_key" ON "activity_forecasts"("activityId");

-- CreateIndex
CREATE INDEX "progress_entries_siteId_entryDate_idx" ON "progress_entries"("siteId", "entryDate");

-- CreateIndex
CREATE INDEX "progress_entries_entityId_idx" ON "progress_entries"("entityId");

-- CreateIndex
CREATE INDEX "progress_entries_activityId_isCurrent_idx" ON "progress_entries"("activityId", "isCurrent");

-- CreateIndex
CREATE INDEX "photos_siteId_kind_createdAt_idx" ON "photos"("siteId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ai_progress_estimates_activityId_createdAt_idx" ON "ai_progress_estimates"("activityId", "createdAt");

-- CreateIndex
CREATE INDEX "measurement_books_siteId_mbDate_idx" ON "measurement_books"("siteId", "mbDate");

-- CreateIndex
CREATE INDEX "measurement_books_entityId_idx" ON "measurement_books"("entityId");

-- CreateIndex
CREATE INDEX "mb_lines_measurementBookId_idx" ON "mb_lines"("measurementBookId");

-- CreateIndex
CREATE UNIQUE INDEX "materials_name_key" ON "materials"("name");

-- CreateIndex
CREATE UNIQUE INDEX "mix_designs_code_key" ON "mix_designs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "mix_design_coefficients_mixId_materialId_key" ON "mix_design_coefficients"("mixId", "materialId");

-- CreateIndex
CREATE INDEX "material_receipts_siteId_receivedDate_idx" ON "material_receipts"("siteId", "receivedDate");

-- CreateIndex
CREATE INDEX "material_receipts_entityId_idx" ON "material_receipts"("entityId");

-- CreateIndex
CREATE INDEX "consumption_entries_siteId_entryDate_idx" ON "consumption_entries"("siteId", "entryDate");

-- CreateIndex
CREATE INDEX "consumption_entries_entityId_idx" ON "consumption_entries"("entityId");

-- CreateIndex
CREATE INDEX "consumption_entries_activityId_isCurrent_idx" ON "consumption_entries"("activityId", "isCurrent");

-- CreateIndex
CREATE INDEX "stockpile_scans_siteId_createdAt_idx" ON "stockpile_scans"("siteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scan_frames_scanId_sequence_key" ON "scan_frames"("scanId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "scan_jobs_scanId_key" ON "scan_jobs"("scanId");

-- CreateIndex
CREATE INDEX "scan_jobs_state_createdAt_idx" ON "scan_jobs"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scan_results_scanId_key" ON "scan_results"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "scan_decisions_scanId_key" ON "scan_decisions"("scanId");

-- CreateIndex
CREATE INDEX "requisitions_siteId_kind_createdAt_idx" ON "requisitions"("siteId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "requisitions_entityId_idx" ON "requisitions"("entityId");

-- CreateIndex
CREATE INDEX "approval_actions_requisitionEntityId_createdAt_idx" ON "approval_actions"("requisitionEntityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_types_name_key" ON "work_types"("name");

-- CreateIndex
CREATE INDEX "labour_entries_siteId_createdAt_idx" ON "labour_entries"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "labour_entries_entityId_idx" ON "labour_entries"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "labour_period_closures_labourEntityId_key" ON "labour_period_closures"("labourEntityId");

-- CreateIndex
CREATE INDEX "benchmark_rates_workTypeId_effectiveFrom_idx" ON "benchmark_rates"("workTypeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "audit_flags_siteId_status_severity_idx" ON "audit_flags"("siteId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "audit_flags_rule_subjectType_subjectId_key" ON "audit_flags"("rule", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "edit_log_entityType_entityId_idx" ON "edit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "edit_log_createdAt_idx" ON "edit_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "amendment_policies_recordType_key" ON "amendment_policies"("recordType");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_siteId_businessDate_key" ON "day_closes"("siteId", "businessDate");

-- AddForeignKey
ALTER TABLE "site_roles" ADD CONSTRAINT "site_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_roles" ADD CONSTRAINT "site_roles_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggested_dates" ADD CONSTRAINT "suggested_dates_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "schedule_suggestions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mb_lines" ADD CONSTRAINT "mb_lines_measurementBookId_fkey" FOREIGN KEY ("measurementBookId") REFERENCES "measurement_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mix_design_coefficients" ADD CONSTRAINT "mix_design_coefficients_mixId_fkey" FOREIGN KEY ("mixId") REFERENCES "mix_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_frames" ADD CONSTRAINT "scan_frames_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "stockpile_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "stockpile_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "stockpile_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_decisions" ADD CONSTRAINT "scan_decisions_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "stockpile_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
