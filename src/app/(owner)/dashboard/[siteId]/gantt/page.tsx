import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { getCurrentBaseline } from "@/lib/schedule/service";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { GanttSvg, type GanttRow } from "@/components/gantt/GanttSvg";
import { ScheduleReview } from "./schedule-review";

export default async function GanttPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [activities, baseline, suggestion] = await Promise.all([
    prisma.activity.findMany({ where: { siteId }, orderBy: { sequence: "asc" } }),
    getCurrentBaseline(siteId),
    prisma.scheduleSuggestion.findFirst({
      where: { siteId },
      orderBy: { generatedAt: "desc" },
      include: { dates: true },
    }),
  ]);

  const [forecasts, progressTotals] = await Promise.all([
    prisma.activityForecast.findMany({
      where: { activityId: { in: activities.map((a) => a.id) } },
    }),
    prisma.progressEntry.groupBy({
      by: ["activityId"],
      where: { siteId, isCurrent: true, status: "submitted" },
      _sum: { qtyDone: true },
    }),
  ]);

  const forecastByActivity = new Map(forecasts.map((f) => [f.activityId, f]));
  const doneByActivity = new Map(
    progressTotals.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)])
  );
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const ganttRows: GanttRow[] = (baseline?.activities ?? [])
    .map((baselineActivity) => {
      const activity = activityById.get(baselineActivity.activityId);
      if (!activity) return null;
      const forecast = forecastByActivity.get(activity.id);
      const boq = Number(baselineActivity.plannedQty ?? activity.boqQty ?? 0);
      const done = doneByActivity.get(activity.id) ?? 0;
      return {
        code: activity.code,
        name: activity.name,
        plannedStart: dateOnly(baselineActivity.plannedStart),
        plannedEnd: dateOnly(baselineActivity.plannedEnd),
        progressPct: boq > 0 ? Math.min(100, (done / boq) * 100) : 0,
        forecastEnd: forecast?.forecastEnd ? dateOnly(forecast.forecastEnd) : null,
        slipPct: forecast?.slipPct !== null && forecast !== undefined ? Number(forecast.slipPct) : null,
        contractorName: activity.contractorName,
      };
    })
    .filter((row): row is GanttRow => row !== null)
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));

  return (
    <div className="space-y-4">
      {baseline ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Locked baseline v{baseline.version} · locked{" "}
              {baseline.lockedAt.toLocaleDateString("en-IN")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ganttRows.length > 0 ? (
              <GanttSvg rows={ganttRows} todayIso={businessDateIST()} />
            ) : (
              <p className="text-sm text-slate-500">Baseline has no activities.</p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              The baseline is locked — actuals are measured against it. Re-baselining creates a
              new logged version below; it never rewrites this one.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ScheduleReview
        siteId={siteId}
        hasBaseline={baseline !== null}
        activities={activities.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          category: a.category,
          boqQty: a.boqQty?.toString() ?? null,
          unit: a.unit,
          norm: a.productivityNormQtyPerDay?.toString() ?? null,
        }))}
        suggestion={
          suggestion
            ? {
                generatedAt: suggestion.generatedAt.toISOString(),
                dates: suggestion.dates.map((d) => ({
                  activityId: d.activityId,
                  suggStart: dateOnly(d.suggStart),
                  suggEnd: dateOnly(d.suggEnd),
                  monsoonAffected: d.monsoonAffected,
                })),
              }
            : null
        }
      />
    </div>
  );
}
