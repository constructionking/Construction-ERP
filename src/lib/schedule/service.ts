import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { suggestSchedule } from "./suggest";
import { DEFAULT_MONSOON_CONFIG, type MonsoonConfig } from "./monsoon";
import { computeForecast } from "./forecast";
import { evaluateContractorDelay } from "@/lib/audit/rules/contractor-delay";
import { raiseFlag, autoResolveFlag } from "@/lib/audit/engine";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";

export async function runScheduleSuggestion(
  siteId: string,
  config?: Partial<MonsoonConfig> & { startDate?: string }
) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    // Leaves only: main-activity headings are never scheduled — their Gantt
    // bars are DERIVED as the span of their children.
    include: { activities: { where: { isGroup: false }, include: { predecessors: true } } },
  });
  if (!site) throw new ApiError(404, "Site not found");
  if (site.activities.length === 0) {
    throw new ApiError(400, "Define the activity list (WBS) before suggesting a schedule");
  }

  // An explicitly chosen project start date sticks to the site, so every
  // regeneration (and the dashboards) model from the same day.
  if (config?.startDate) {
    await prisma.site.update({
      where: { id: siteId },
      data: { startDate: new Date(config.startDate) },
    });
  }
  const startIso =
    config?.startDate ?? (site.startDate ? dateOnly(site.startDate) : businessDateIST());

  const monsoonConfig: MonsoonConfig = {
    months: config?.months ?? DEFAULT_MONSOON_CONFIG.months,
    multipliers: { ...DEFAULT_MONSOON_CONFIG.multipliers, ...(config?.multipliers ?? {}) },
  };

  const dependencies = site.activities.flatMap((a) =>
    a.predecessors.map((d) => ({
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      lagDays: d.lagDays,
    }))
  );

  const dates = suggestSchedule({
    siteStartIso: startIso,
    activities: site.activities.map((a) => ({
      id: a.id,
      category: a.category,
      boqQty: a.boqQty !== null ? Number(a.boqQty) : null,
      normPerDay:
        a.productivityNormQtyPerDay !== null ? Number(a.productivityNormQtyPerDay) : null,
      sequence: a.sequence,
    })),
    dependencies,
    config: monsoonConfig,
  });

  const suggestion = await prisma.scheduleSuggestion.create({
    data: {
      siteId,
      params: monsoonConfig as unknown as Prisma.InputJsonValue,
      dates: {
        create: dates.map((d) => ({
          activityId: d.activityId,
          suggStart: new Date(d.suggStart),
          suggEnd: new Date(d.suggEnd),
          monsoonAffected: d.monsoonAffected,
          multiplier: d.effectiveMultiplier,
        })),
      },
    },
    include: { dates: true },
  });
  return suggestion;
}

export async function lockBaseline(
  siteId: string,
  lockedById: string,
  activities: Array<{ activityId: string; plannedStart: string; plannedEnd: string }>,
  note?: string
) {
  const siteActivities = await prisma.activity.findMany({ where: { siteId } });
  const validIds = new Set(siteActivities.map((a) => a.id));
  for (const item of activities) {
    if (!validIds.has(item.activityId)) {
      throw new ApiError(400, "Baseline contains an activity not on this site");
    }
    if (item.plannedEnd < item.plannedStart) {
      throw new ApiError(400, "Planned end before planned start");
    }
  }
  if (activities.length === 0) throw new ApiError(400, "Baseline cannot be empty");

  const boqById = new Map(siteActivities.map((a) => [a.id, a.boqQty]));
  const latest = await prisma.baseline.findFirst({
    where: { siteId },
    orderBy: { version: "desc" },
  });

  // Lock = INSERT of a new immutable version (DB triggers forbid update/delete).
  return prisma.baseline.create({
    data: {
      siteId,
      version: (latest?.version ?? 0) + 1,
      lockedById,
      note,
      activities: {
        create: activities.map((item) => ({
          activityId: item.activityId,
          plannedStart: new Date(item.plannedStart),
          plannedEnd: new Date(item.plannedEnd),
          plannedQty: boqById.get(item.activityId) ?? null,
        })),
      },
    },
    include: { activities: true },
  });
}

export async function getCurrentBaseline(siteId: string) {
  return prisma.baseline.findFirst({
    where: { siteId },
    orderBy: { version: "desc" },
    include: { activities: true },
  });
}

/**
 * Recompute forecasts for every baselined activity of a site, upsert
 * activity_forecasts, and raise/clear contractor-delay flags (>10% slip).
 */
export async function recomputeForecasts(siteId: string) {
  const baseline = await getCurrentBaseline(siteId);
  if (!baseline) return { updated: 0 };

  const activities = await prisma.activity.findMany({ where: { siteId } });
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const today = businessDateIST();

  const progress = await prisma.progressEntry.findMany({
    where: {
      siteId,
      isCurrent: true,
      status: "submitted",
      activityId: { in: baseline.activities.map((b) => b.activityId) },
    },
    select: { activityId: true, entryDate: true, qtyDone: true },
  });
  const entriesByActivity = new Map<string, Array<{ date: string; qty: number }>>();
  for (const entry of progress) {
    const list = entriesByActivity.get(entry.activityId) ?? [];
    list.push({ date: dateOnly(entry.entryDate), qty: Number(entry.qtyDone) });
    entriesByActivity.set(entry.activityId, list);
  }

  let updated = 0;
  for (const baselineActivity of baseline.activities) {
    const activity = activityById.get(baselineActivity.activityId);
    if (!activity) continue;

    const forecast = computeForecast({
      plannedStart: dateOnly(baselineActivity.plannedStart),
      plannedEnd: dateOnly(baselineActivity.plannedEnd),
      plannedQty:
        baselineActivity.plannedQty !== null ? Number(baselineActivity.plannedQty) : null,
      entries: entriesByActivity.get(baselineActivity.activityId) ?? [],
      todayIso: today,
    });
    if (!forecast) continue;

    await prisma.activityForecast.upsert({
      where: { activityId: baselineActivity.activityId },
      create: {
        activityId: baselineActivity.activityId,
        forecastEnd: new Date(forecast.forecastEnd),
        slipPct: forecast.slipPct,
      },
      update: {
        forecastEnd: new Date(forecast.forecastEnd),
        slipPct: forecast.slipPct,
        computedAt: new Date(),
      },
    });
    updated += 1;

    const delay = evaluateContractorDelay({
      slipPct: forecast.slipPct,
      contractorName: activity.contractorName,
    });
    if (delay && forecast.status !== "complete") {
      await raiseFlag({
        siteId,
        rule: "contractor_delay",
        severity: delay.severity,
        subjectType: "activity",
        subjectId: activity.id,
        details: {
          activityCode: activity.code,
          activityName: activity.name,
          contractorName: activity.contractorName,
          plannedEnd: dateOnly(baselineActivity.plannedEnd),
          forecastEnd: forecast.forecastEnd,
          slipDays: forecast.slipDays,
          slipPct: forecast.slipPct,
        },
        title: `${activity.contractorName}: ${forecast.slipPct.toFixed(0)}% behind on ${activity.code}`,
        body: `${activity.name} forecast to finish ${forecast.slipDays} days late (${forecast.forecastEnd} vs planned ${dateOnly(baselineActivity.plannedEnd)})`,
      });
    } else {
      await autoResolveFlag("contractor_delay", "activity", activity.id);
    }
  }
  return { updated };
}
