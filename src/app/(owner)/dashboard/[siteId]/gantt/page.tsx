import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { getCurrentBaseline } from "@/lib/schedule/service";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { type GanttRow } from "@/components/gantt/GanttSvg";
import { GanttChart, type GanttGroup } from "@/components/gantt/GanttChart";
import { ScheduleReview } from "./schedule-review";

export default async function GanttPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [activities, baseline, suggestion, site] = await Promise.all([
    prisma.activity.findMany({ where: { siteId }, orderBy: { sequence: "asc" } }),
    getCurrentBaseline(siteId),
    prisma.scheduleSuggestion.findFirst({
      where: { siteId },
      orderBy: { generatedAt: "desc" },
      include: { dates: true },
    }),
    prisma.site.findUnique({ where: { id: siteId }, select: { startDate: true } }),
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

  // Leaf rows from the locked baseline, then grouped under their MAIN
  // activities; each parent's bar is DERIVED (span of children, BOQ-weighted
  // progress, worst forecast) — parents are never baselined themselves.
  const leafRows = (baseline?.activities ?? [])
    .map((baselineActivity) => {
      const activity = activityById.get(baselineActivity.activityId);
      if (!activity || activity.isGroup) return null;
      const forecast = forecastByActivity.get(activity.id);
      const boq = Number(baselineActivity.plannedQty ?? activity.boqQty ?? 0);
      const done = doneByActivity.get(activity.id) ?? 0;
      const row: GanttRow = {
        code: activity.code,
        name: activity.name,
        plannedStart: dateOnly(baselineActivity.plannedStart),
        plannedEnd: dateOnly(baselineActivity.plannedEnd),
        progressPct: boq > 0 ? Math.min(100, (done / boq) * 100) : 0,
        forecastEnd: forecast?.forecastEnd ? dateOnly(forecast.forecastEnd) : null,
        slipPct: forecast?.slipPct !== null && forecast !== undefined ? Number(forecast.slipPct) : null,
        contractorName: activity.contractorName,
      };
      return { row, parentId: activity.parentId, boq };
    })
    .filter((r): r is { row: GanttRow; parentId: string | null; boq: number } => r !== null)
    .sort((a, b) => a.row.plannedStart.localeCompare(b.row.plannedStart));

  const ganttGroups: GanttGroup[] = [];
  {
    const parents = activities.filter((a) => a.isGroup);
    for (const parent of parents) {
      const children = leafRows.filter((l) => l.parentId === parent.id);
      if (children.length === 0) continue;
      const boqSum = children.reduce((s, c) => s + c.boq, 0);
      const weighted = children.reduce(
        (s, c) => s + c.row.progressPct * (boqSum > 0 ? c.boq / boqSum : 1 / children.length),
        0,
      );
      const worst = children.reduce<GanttRow | null>(
        (acc, c) => (c.row.slipPct !== null && (acc?.slipPct == null || c.row.slipPct > acc.slipPct) ? c.row : acc),
        null,
      );
      ganttGroups.push({
        parent: {
          code: parent.code,
          name: parent.name,
          plannedStart: children.reduce((m, c) => (c.row.plannedStart < m ? c.row.plannedStart : m), children[0].row.plannedStart),
          plannedEnd: children.reduce((m, c) => (c.row.plannedEnd > m ? c.row.plannedEnd : m), children[0].row.plannedEnd),
          progressPct: weighted,
          forecastEnd: children.reduce<string | null>(
            (m, c) => (c.row.forecastEnd && (!m || c.row.forecastEnd > m) ? c.row.forecastEnd : m),
            null,
          ),
          slipPct: worst?.slipPct ?? null,
          contractorName: null,
        },
        children: children.map((c) => c.row),
      });
    }
    const ungrouped = leafRows.filter(
      (l) => !l.parentId || !parents.some((p) => p.id === l.parentId),
    );
    if (ungrouped.length > 0) {
      ganttGroups.push({ parent: null, children: ungrouped.map((c) => c.row) });
    }
  }
  const ganttRowCount = leafRows.length;

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
            {ganttRowCount > 0 ? (
              <GanttChart groups={ganttGroups} todayIso={businessDateIST()} />
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
        siteStartDate={site?.startDate ? dateOnly(site.startDate) : null}
        groups={activities
          .filter((a) => a.isGroup)
          .map((g) => ({
            id: g.id,
            name: g.name,
            startDate: g.startDate ? dateOnly(g.startDate) : null,
          }))}
        activities={activities.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          isGroup: a.isGroup,
          parentId: a.parentId,
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
