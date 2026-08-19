import { prisma } from "@/lib/db";
import { labourTotalCost, labourCostPerUnit, inclusiveDays } from "@/lib/labour";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";

export interface LabourReportLine {
  entityId: string;
  workTypeName: string;
  entryType: string;
  source: string;
  contractorName: string | null;
  workersCount: number;
  rate: number;
  rateBasis: string;
  periodLabel: string;
  open: boolean;
  outputQty: number | null;
  outputUnit: string | null;
  totalCost: number;
  costPerUnit: number | null;
  benchmarkCostPerUnit: number | null;
  overrunPct: number | null;
}

export async function labourReport(siteId: string): Promise<LabourReportLine[]> {
  const [entries, workTypes, benchmarks] = await Promise.all([
    prisma.labourEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.workType.findMany(),
    prisma.benchmarkRate.findMany({ orderBy: { effectiveFrom: "desc" } }),
  ]);
  const closures = await prisma.labourPeriodClosure.findMany({
    where: { labourEntityId: { in: entries.map((e) => e.entityId) } },
  });
  const closureByEntity = new Map(closures.map((c) => [c.labourEntityId, c]));
  const workTypeById = new Map(workTypes.map((w) => [w.id, w]));
  const today = businessDateIST();

  return entries.map((entry) => {
    const closure = closureByEntity.get(entry.entityId);
    const outputQty =
      closure !== undefined
        ? Number(closure.finalOutputQty)
        : entry.outputQty !== null
          ? Number(entry.outputQty)
          : null;
    const endIso = closure
      ? dateOnly(closure.closedOn)
      : entry.periodEnd
        ? dateOnly(entry.periodEnd)
        : today;
    const periodDays =
      entry.entryType === "period" && entry.periodStart
        ? inclusiveDays(dateOnly(entry.periodStart), endIso)
        : 1;
    const costInput = {
      entryType: entry.entryType,
      rateBasis: entry.rateBasis,
      workersCount: entry.workersCount,
      rate: Number(entry.rate),
      outputQty,
      periodDays,
    } as const;
    const totalCost = labourTotalCost(costInput);
    const costPerUnit = labourCostPerUnit(costInput);

    const referenceDate = entry.entryDate ?? entry.periodStart ?? entry.createdAt;
    const benchmark = benchmarks.find(
      (b) =>
        b.workTypeId === entry.workTypeId &&
        (entry.outputUnit === null || b.unit === entry.outputUnit) &&
        b.effectiveFrom <= referenceDate
    );
    const benchmarkValue = benchmark ? Number(benchmark.benchmarkCostPerUnit) : null;

    return {
      entityId: entry.entityId,
      workTypeName: workTypeById.get(entry.workTypeId)?.name ?? "Work",
      entryType: entry.entryType,
      source: entry.source,
      contractorName: entry.contractorName,
      workersCount: entry.workersCount,
      rate: Number(entry.rate),
      rateBasis: entry.rateBasis,
      periodLabel:
        entry.entryType === "day_rate"
          ? (entry.entryDate ? dateOnly(entry.entryDate) : "")
          : `${entry.periodStart ? dateOnly(entry.periodStart) : "?"} → ${closure ? dateOnly(closure.closedOn) : "open"}`,
      open: entry.entryType === "period" && !closure,
      outputQty,
      outputUnit: entry.outputUnit,
      totalCost,
      costPerUnit,
      benchmarkCostPerUnit: benchmarkValue,
      overrunPct:
        costPerUnit !== null && benchmarkValue !== null && benchmarkValue > 0
          ? Number((((costPerUnit - benchmarkValue) / benchmarkValue) * 100).toFixed(1))
          : null,
    };
  });
}
