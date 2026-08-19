import { prisma } from "@/lib/db";

export interface ConsumptionReportLine {
  activityCode: string;
  activityName: string;
  mixCode: string;
  materialName: string;
  unit: string;
  progressQty: number;
  theoretical: number;
  actual: number;
  variancePct: number | null;
}

/** Theoretical (mix coefficients × progress qty) vs actual, per activity+mix+material. */
export async function consumptionReport(siteId: string): Promise<ConsumptionReportLine[]> {
  const pairs = await prisma.consumptionEntry.groupBy({
    by: ["activityId", "mixDesignId", "materialId"],
    where: { siteId, isCurrent: true, status: "submitted", mixDesignId: { not: null } },
    _sum: { qty: true },
  });
  if (pairs.length === 0) return [];

  const [activities, mixes, materials, progress] = await Promise.all([
    prisma.activity.findMany({ where: { siteId } }),
    prisma.mixDesign.findMany({ include: { coefficients: true } }),
    prisma.material.findMany(),
    prisma.progressEntry.groupBy({
      by: ["activityId"],
      where: { siteId, isCurrent: true, status: "submitted" },
      _sum: { qtyDone: true },
    }),
  ]);

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const mixById = new Map(mixes.map((m) => [m.id, m]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const progressByActivity = new Map(
    progress.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)])
  );

  const lines: ConsumptionReportLine[] = [];
  for (const pair of pairs) {
    const activity = activityById.get(pair.activityId);
    const mix = pair.mixDesignId ? mixById.get(pair.mixDesignId) : undefined;
    const material = materialById.get(pair.materialId);
    if (!activity || !mix || !material) continue;
    const coefficient = mix.coefficients.find((c) => c.materialId === pair.materialId);
    const progressQty = progressByActivity.get(pair.activityId) ?? 0;
    const theoretical = coefficient ? Number(coefficient.qtyPerUnit) * progressQty : 0;
    const actual = Number(pair._sum.qty ?? 0);
    lines.push({
      activityCode: activity.code,
      activityName: activity.name,
      mixCode: mix.code,
      materialName: material.name,
      unit: material.unit,
      progressQty,
      theoretical,
      actual,
      variancePct:
        theoretical > 0 ? Number((((actual - theoretical) / theoretical) * 100).toFixed(1)) : null,
    });
  }
  return lines.sort((a, b) => (b.variancePct ?? -999) - (a.variancePct ?? -999));
}
