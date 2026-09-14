import { prisma } from "@/lib/db";

// Owner consumption report: THEORETICAL (mix coefficient × recorded work)
// vs ACTUAL (engineer's daily consumption reports) — per material for the
// whole site, and per sub-activity under its main activity. Consumption
// booked without a mix is shown too (actual only, no norm to compare).

export interface MaterialRollup {
  materialId: string;
  name: string;
  unit: string;
  category: string;
  theoretical: number; // summed over activities that have a mix norm for it
  actual: number; // all consumption of the material in the period
  actualAgainstNorm: number; // the part of actual booked on mix-linked work
  variancePct: number | null;
}

export interface ActivityLine {
  materialId: string;
  materialName: string;
  unit: string;
  theoretical: number | null; // null = no norm (no mix / not in the mix)
  actual: number;
  variancePct: number | null;
}

export interface ActivityBlock {
  activityId: string;
  activityCode: string;
  activityName: string;
  parentName: string | null;
  mixName: string | null;
  mixStatus: string | null;
  outputUnit: string;
  progressQty: number;
  lines: ActivityLine[];
  worstVariancePct: number | null;
}

export interface ConsumptionReport {
  materials: MaterialRollup[];
  activities: ActivityBlock[];
  reportCount: number; // distinct (date, activity) reports in the period
}

function pct(actual: number, theoretical: number): number | null {
  return theoretical > 0 ? Number((((actual - theoretical) / theoretical) * 100).toFixed(1)) : null;
}

export async function consumptionReport(
  siteId: string,
  opts: { from?: Date } = {}
): Promise<ConsumptionReport> {
  const dateFilter = opts.from ? { entryDate: { gte: opts.from } } : {};

  const [pairs, progress, activities, mixes, materials, reportKeys] = await Promise.all([
    prisma.consumptionEntry.groupBy({
      by: ["activityId", "mixDesignId", "materialId"],
      where: { siteId, isCurrent: true, status: "submitted", ...dateFilter },
      _sum: { qty: true },
    }),
    prisma.progressEntry.groupBy({
      by: ["activityId"],
      where: { siteId, isCurrent: true, status: "submitted", ...dateFilter },
      _sum: { qtyDone: true },
    }),
    prisma.activity.findMany({
      where: { siteId, isGroup: false },
      include: { parent: { select: { name: true } } },
      orderBy: { sequence: "asc" },
    }),
    prisma.mixDesign.findMany({ include: { coefficients: true } }),
    prisma.material.findMany(),
    prisma.consumptionEntry.groupBy({
      by: ["activityId", "entryDate"],
      where: { siteId, isCurrent: true, status: "submitted", ...dateFilter },
    }),
  ]);

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const mixById = new Map(mixes.map((m) => [m.id, m]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const progressByActivity = new Map(progress.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)]));

  // Per activity: the mix its consumption was booked against (most-used wins).
  const blocks = new Map<string, ActivityBlock>();
  const rollup = new Map<string, MaterialRollup>();
  const bump = (materialId: string, delta: Partial<Pick<MaterialRollup, "theoretical" | "actual" | "actualAgainstNorm">>) => {
    const m = materialById.get(materialId);
    if (!m) return;
    const r = rollup.get(materialId) ?? {
      materialId,
      name: m.name,
      unit: m.unit,
      category: m.category,
      theoretical: 0,
      actual: 0,
      actualAgainstNorm: 0,
      variancePct: null,
    };
    r.theoretical += delta.theoretical ?? 0;
    r.actual += delta.actual ?? 0;
    r.actualAgainstNorm += delta.actualAgainstNorm ?? 0;
    rollup.set(materialId, r);
  };

  for (const pair of pairs) {
    const activity = activityById.get(pair.activityId);
    const material = materialById.get(pair.materialId);
    if (!activity || !material) continue;
    const mix = pair.mixDesignId ? mixById.get(pair.mixDesignId) : undefined;
    const progressQty = progressByActivity.get(pair.activityId) ?? 0;
    const coefficient = mix?.coefficients.find((c) => c.materialId === pair.materialId);
    const theoretical = coefficient && mix?.status !== "tbd" ? Number(coefficient.qtyPerUnit) * progressQty : null;
    const actual = Number(pair._sum.qty ?? 0);

    const key = pair.activityId;
    const block = blocks.get(key) ?? {
      activityId: activity.id,
      activityCode: activity.code,
      activityName: activity.name,
      parentName: activity.parent?.name ?? null,
      mixName: mix?.name ?? null,
      mixStatus: mix?.status ?? null,
      outputUnit: mix?.outputUnit ?? activity.unit ?? "CUM",
      progressQty,
      lines: [],
      worstVariancePct: null,
    };
    if (!block.mixName && mix) {
      block.mixName = mix.name;
      block.mixStatus = mix.status;
      block.outputUnit = mix.outputUnit;
    }
    const existing = block.lines.find((l) => l.materialId === pair.materialId);
    if (existing) {
      existing.actual += actual;
      if (theoretical !== null) existing.theoretical = (existing.theoretical ?? 0) + theoretical;
      existing.variancePct = existing.theoretical !== null ? pct(existing.actual, existing.theoretical) : null;
    } else {
      block.lines.push({
        materialId: pair.materialId,
        materialName: material.name,
        unit: material.unit,
        theoretical,
        actual,
        variancePct: theoretical !== null ? pct(actual, theoretical) : null,
      });
    }
    blocks.set(key, block);

    bump(pair.materialId, {
      actual,
      theoretical: theoretical ?? 0,
      actualAgainstNorm: theoretical !== null ? actual : 0,
    });
  }

  const activityBlocks = [...blocks.values()].map((b) => {
    b.lines.sort((x, y) => (y.variancePct ?? -999) - (x.variancePct ?? -999));
    b.worstVariancePct = b.lines.reduce<number | null>(
      (w, l) => (l.variancePct !== null && (w === null || l.variancePct > w) ? l.variancePct : w),
      null
    );
    return b;
  });
  activityBlocks.sort((a, b) => (b.worstVariancePct ?? -999) - (a.worstVariancePct ?? -999));

  const materialRollups = [...rollup.values()].map((r) => ({
    ...r,
    variancePct: pct(r.actualAgainstNorm, r.theoretical),
  }));
  materialRollups.sort((a, b) => (b.variancePct ?? -999) - (a.variancePct ?? -999));

  return { materials: materialRollups, activities: activityBlocks, reportCount: reportKeys.length };
}
