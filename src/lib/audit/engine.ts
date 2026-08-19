import { Prisma, type AuditRule, type FlagSeverity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateConsumptionVariance } from "./rules/consumption-variance";
import { evaluateReceiptVsRequisition } from "./rules/receipt-checks";
import { evaluateLabourCost } from "./rules/labour-cost";
import { labourCostPerUnit, inclusiveDays } from "@/lib/labour";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";

// ---------------------------------------------------------------------------
// Cross-cutting audit engine. Rules are pure functions in ./rules; this file
// wires them to data, upserts flags (unique per rule+subject, reopening if the
// condition recurs after review) and notifies every owner.
// ---------------------------------------------------------------------------

export interface FlagInput {
  siteId: string;
  rule: AuditRule;
  severity: FlagSeverity;
  subjectType: string;
  subjectId: string;
  details: Record<string, unknown>;
  title: string;
  body: string;
}

export async function raiseFlag(input: FlagInput) {
  const existing = await prisma.auditFlag.findUnique({
    where: {
      rule_subjectType_subjectId: {
        rule: input.rule,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    },
  });

  const flag = await prisma.auditFlag.upsert({
    where: {
      rule_subjectType_subjectId: {
        rule: input.rule,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    },
    create: {
      siteId: input.siteId,
      rule: input.rule,
      severity: input.severity,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      details: input.details as Prisma.InputJsonValue,
      status: "open",
    },
    update: {
      severity: input.severity,
      details: input.details as Prisma.InputJsonValue,
      // A resolved flag whose condition recurs reopens; acknowledged stays.
      status: existing?.status === "resolved" ? "open" : undefined,
    },
  });

  // Notify owners on first raise or reopen only (not every re-evaluation).
  const isNew = !existing || existing.status === "resolved";
  if (isNew) {
    const owners = await prisma.user.findMany({ where: { isOwner: true, isActive: true } });
    await prisma.notification.createMany({
      data: owners.map((owner) => ({
        userId: owner.id,
        flagId: flag.id,
        title: input.title,
        body: input.body,
      })),
    });
  }

  return flag;
}

/** Auto-resolve a flag whose condition no longer holds. */
export async function autoResolveFlag(rule: AuditRule, subjectType: string, subjectId: string) {
  await prisma.auditFlag
    .update({
      where: { rule_subjectType_subjectId: { rule, subjectType, subjectId } },
      data: { status: "resolved", reviewNote: "auto-resolved: condition cleared" },
    })
    .catch(() => {}); // no flag = nothing to resolve
}

// ---------------------------------------------------------------------------
// Consumption variance (real-time on submit + nightly sweep)
// ---------------------------------------------------------------------------

export async function runConsumptionAudit(scope: {
  siteId: string;
  activityId: string;
  mixDesignId: string | null;
}) {
  if (!scope.mixDesignId) return null;

  const [mix, progress, consumption, materials] = await Promise.all([
    prisma.mixDesign.findUnique({
      where: { id: scope.mixDesignId },
      include: { coefficients: true },
    }),
    prisma.progressEntry.aggregate({
      where: {
        activityId: scope.activityId,
        isCurrent: true,
        status: "submitted",
      },
      _sum: { qtyDone: true },
    }),
    prisma.consumptionEntry.groupBy({
      by: ["materialId"],
      where: {
        activityId: scope.activityId,
        mixDesignId: scope.mixDesignId,
        isCurrent: true,
        status: "submitted",
      },
      _sum: { qty: true },
    }),
    prisma.material.findMany({ select: { id: true, name: true, unit: true } }),
  ]);
  if (!mix) return null;

  const findings = evaluateConsumptionVariance({
    progressQty: Number(progress._sum.qtyDone ?? 0),
    coefficients: mix.coefficients.map((c) => ({
      materialId: c.materialId,
      qtyPerUnit: Number(c.qtyPerUnit),
    })),
    actualByMaterial: consumption.map((c) => ({
      materialId: c.materialId,
      qty: Number(c._sum.qty ?? 0),
    })),
  });

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const activity = await prisma.activity.findUnique({ where: { id: scope.activityId } });

  for (const coefficient of mix.coefficients) {
    const finding = findings.find((f) => f.materialId === coefficient.materialId);
    const subjectId = `${scope.activityId}:${coefficient.materialId}`;
    if (!finding) {
      await autoResolveFlag("consumption_variance", "activity_material", subjectId);
      continue;
    }
    const material = materialById.get(finding.materialId);
    await raiseFlag({
      siteId: scope.siteId,
      rule: "consumption_variance",
      severity: finding.severity,
      subjectType: "activity_material",
      subjectId,
      details: {
        activityId: scope.activityId,
        activityCode: activity?.code,
        materialId: finding.materialId,
        materialName: material?.name,
        mixCode: mix.code,
        theoretical: Number(finding.theoretical.toFixed(3)),
        actual: Number(finding.actual.toFixed(3)),
        variancePct: Number(finding.variancePct.toFixed(1)),
        unit: material?.unit,
      },
      title: `Consumption ${finding.variancePct.toFixed(0)}% over mix design`,
      body: `${material?.name ?? "Material"} on ${activity?.code ?? "activity"}: actual ${finding.actual.toFixed(1)} vs theoretical ${finding.theoretical.toFixed(1)} (${mix.code})`,
    });
  }

  return findings.length ? findings : null;
}

// ---------------------------------------------------------------------------
// Receipt audits: quality flag + over-requisition check
// ---------------------------------------------------------------------------

export async function runReceiptAudits(receiptId: string) {
  const receipt = await prisma.materialReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return;

  const material = await prisma.material.findUnique({ where: { id: receipt.materialId } });

  if (!receipt.qualityAdequate) {
    await raiseFlag({
      siteId: receipt.siteId,
      rule: "quality_inadequate",
      severity: "warn",
      subjectType: "material_receipt",
      subjectId: receipt.entityId,
      details: {
        materialId: receipt.materialId,
        materialName: material?.name,
        qty: Number(receipt.qty),
        unit: receipt.unit,
        supplier: receipt.supplier,
        challanNo: receipt.challanNo,
        remarks: receipt.qualityRemarks,
      },
      title: "Material received with inadequate quality",
      body: `${material?.name ?? "Material"} from ${receipt.supplier} (challan ${receipt.challanNo}) marked quality-inadequate by the engineer`,
    });
  }

  if (receipt.requisitionEntityId) {
    const requisition = await prisma.requisition.findFirst({
      where: { entityId: receipt.requisitionEntityId, isCurrent: true },
    });
    if (requisition && requisition.kind === "material") {
      const lines = requisition.lines as Array<{ materialId: string; qty: number }>;
      const line = lines.find((l) => l.materialId === receipt.materialId);
      if (line) {
        const others = await prisma.materialReceipt.aggregate({
          where: {
            requisitionEntityId: receipt.requisitionEntityId,
            materialId: receipt.materialId,
            isCurrent: true,
            status: "submitted",
            NOT: { entityId: receipt.entityId },
          },
          _sum: { qty: true },
        });
        const finding = evaluateReceiptVsRequisition({
          receivedQty: Number(receipt.qty),
          previouslyReceivedQty: Number(others._sum.qty ?? 0),
          requestedQty: Number(line.qty),
        });
        if (finding) {
          await raiseFlag({
            siteId: receipt.siteId,
            rule: "receipt_requisition_mismatch",
            severity: finding.severity,
            subjectType: "requisition_material",
            subjectId: `${receipt.requisitionEntityId}:${receipt.materialId}`,
            details: {
              materialId: receipt.materialId,
              materialName: material?.name,
              requisitionEntityId: receipt.requisitionEntityId,
              requestedQty: Number(line.qty),
              overshootPct: Number(finding.overshootPct.toFixed(1)),
            },
            title: `Received ${finding.overshootPct.toFixed(0)}% more than requisitioned`,
            body: `${material?.name ?? "Material"}: receipts against the requisition exceed the requested quantity`,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Departmental labour cost vs owner benchmark
// ---------------------------------------------------------------------------

export async function runLabourAudit(labourEntityId: string) {
  const entry = await prisma.labourEntry.findFirst({
    where: { entityId: labourEntityId, isCurrent: true, status: "submitted" },
  });
  if (!entry) return null;

  const closure = await prisma.labourPeriodClosure.findUnique({
    where: { labourEntityId },
  });

  const outputQty =
    closure !== null
      ? Number(closure.finalOutputQty)
      : entry.outputQty !== null
        ? Number(entry.outputQty)
        : null;
  if (outputQty === null || outputQty <= 0) return null;

  const workType = await prisma.workType.findUnique({ where: { id: entry.workTypeId } });

  // Latest benchmark effective on the entry's reference date, matching unit.
  const referenceDate = entry.entryDate ?? entry.periodStart ?? entry.createdAt;
  const benchmark = await prisma.benchmarkRate.findFirst({
    where: {
      workTypeId: entry.workTypeId,
      unit: entry.outputUnit ?? undefined,
      effectiveFrom: { lte: referenceDate },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!benchmark) return null;

  const endIso = closure
    ? dateOnly(closure.closedOn)
    : entry.periodEnd
      ? dateOnly(entry.periodEnd)
      : businessDateIST();
  const periodDays =
    entry.entryType === "period" && entry.periodStart
      ? inclusiveDays(dateOnly(entry.periodStart), endIso)
      : 1;

  const costPerUnit = labourCostPerUnit({
    entryType: entry.entryType,
    rateBasis: entry.rateBasis,
    workersCount: entry.workersCount,
    rate: Number(entry.rate),
    outputQty,
    periodDays,
  });
  if (costPerUnit === null) return null;

  const finding = evaluateLabourCost({
    costPerUnit,
    benchmarkCostPerUnit: Number(benchmark.benchmarkCostPerUnit),
  });

  if (!finding) {
    await autoResolveFlag("labour_cost_over_benchmark", "labour_entry", labourEntityId);
    return null;
  }

  await raiseFlag({
    siteId: entry.siteId,
    rule: "labour_cost_over_benchmark",
    severity: finding.severity,
    subjectType: "labour_entry",
    subjectId: labourEntityId,
    details: {
      workTypeId: entry.workTypeId,
      workTypeName: workType?.name,
      entryType: entry.entryType,
      source: entry.source,
      contractorName: entry.contractorName,
      costPerUnit: Number(finding.costPerUnit.toFixed(2)),
      benchmarkCostPerUnit: Number(finding.benchmarkCostPerUnit.toFixed(2)),
      overrunPct: Number(finding.overrunPct.toFixed(1)),
      unit: entry.outputUnit,
      outputQty,
      periodDays,
    },
    title: `Labour cost ${finding.overrunPct.toFixed(0)}% over benchmark`,
    body: `${workType?.name ?? "Work"}: ₹${finding.costPerUnit.toFixed(0)}/${entry.outputUnit ?? "unit"} vs benchmark ₹${finding.benchmarkCostPerUnit.toFixed(0)}`,
  });

  return finding;
}
