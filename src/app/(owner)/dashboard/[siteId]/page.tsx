import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Badge } from "@/components/ui";
import { FlagList } from "@/components/FlagList";
import { KpiCard, type Rag } from "@/components/viz/KpiCard";
import { SCurve } from "@/components/viz/SCurve";
import { FundFlowBar } from "@/components/viz/FundFlowBar";
import { DelayHeatmap } from "@/components/viz/DelayHeatmap";
import { ManpowerChart } from "@/components/viz/ManpowerChart";
import { formatQty } from "@/lib/format/units";
import { formatINRCompact } from "@/lib/format/inr";
import {
  sCurve,
  delayHeatmap,
  fundPipeline,
  todayOnSite,
  manpowerSeries,
} from "@/lib/reports/dashboard";
import type { Unit } from "@prisma/client";
import { cn } from "@/lib/cn";

// Site dashboard, rebuilt around data visualisation with drill-down:
// three-question KPI strip → S-curve → fund pipeline → today-on-site strip →
// delay heatmap by main activity → manpower → audit flags + latest progress.

function flagDetail(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([key]) => !["activityId", "materialId", "estimateId", "requisitionEntityId", "workTypeId"].includes(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

const RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "7", label: "7 days", days: 7 },
] as const;

export default async function SiteOverview({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { siteId } = await params;
  const { range } = await searchParams;
  await requireSiteRolePage(siteId, []);

  const today = businessDateIST();
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 30;
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [scurve, heatRows, funds, todayStrip, manpower, flags, recentProgress, activities] =
    await Promise.all([
      sCurve(siteId, today),
      delayHeatmap(siteId, today),
      fundPipeline(siteId),
      todayOnSite(siteId, today),
      manpowerSeries(siteId, today, rangeDays),
      prisma.auditFlag.findMany({
        where: { siteId, status: "open" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.progressEntry.findMany({
        where: { siteId, isCurrent: true, status: "submitted", createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.activity.findMany({ where: { siteId }, select: { id: true, code: true, name: true } }),
    ]);

  const activityById = new Map(activities.map((a) => [a.id, a]));

  // Three questions, site-level.
  const withActual = scurve.filter((p) => p.actual !== null);
  const nowPoint = withActual[withActual.length - 1];
  const gapPp = nowPoint ? nowPoint.actual! - nowPoint.planned : null;
  const prevPoint = withActual[withActual.length - 2];
  const weekDelta = nowPoint && prevPoint ? nowPoint.actual! - prevPoint.actual! : null;
  const timeRag: Rag =
    gapPp === null ? null : gapPp < -15 ? "critical" : gapPp < -5 ? "serious" : gapPp < 0 ? "warning" : "good";

  const released = funds.stages[0]?.amount ?? 0;
  const pipelineTotal = funds.stages.reduce((s, st) => s + st.amount, 0);
  const releasedShare = pipelineTotal > 0 ? (released / pipelineTotal) * 100 : null;
  const budgetRag: Rag =
    releasedShare === null || nowPoint === undefined
      ? null
      : releasedShare > nowPoint.actual! + 10
        ? "serious"
        : "good";

  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  const controlRag: Rag = criticalCount > 0 ? "critical" : flags.length > 0 ? "warning" : "good";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="On time?"
          value={
            gapPp === null
              ? "No baseline"
              : gapPp >= 0
                ? `${gapPp.toFixed(1)} pp ahead`
                : `${Math.abs(gapPp).toFixed(1)} pp behind`
          }
          delta={weekDelta}
          deltaGood={true}
          deltaLabel="pp this week"
          sub={nowPoint ? `${nowPoint.actual!.toFixed(0)}% done vs ${nowPoint.planned.toFixed(0)}% planned` : "lock a schedule baseline"}
          rag={timeRag}
          trend={withActual.slice(-8).map((p) => p.actual!)}
        />
        <KpiCard
          label="On budget?"
          value={released > 0 ? `${formatINRCompact(released)} released` : "Nothing released"}
          sub={
            releasedShare !== null && nowPoint
              ? `${releasedShare.toFixed(0)}% of pipeline vs ${nowPoint.actual!.toFixed(0)}% work done`
              : `${formatINRCompact(pipelineTotal)} in the pipeline`
          }
          rag={budgetRag}
        />
        <KpiCard
          label="Under control?"
          value={criticalCount > 0 ? `${criticalCount} critical` : flags.length > 0 ? `${flags.length} flags` : "Clear"}
          sub={
            todayStrip.quiet
              ? "no site update yet today"
              : `${todayStrip.workers} workers · ${todayStrip.activitiesTouched} activities touched today`
          }
          rag={todayStrip.quiet && controlRag === "good" ? "warning" : controlRag}
        />
      </div>

      <Card className={cn(todayStrip.quiet ? "border-amber-300 bg-amber-50/40" : undefined)}>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Today on site</span>
            {todayStrip.quiet ? (
              <span className="font-medium text-amber-700">No update from the site yet today</span>
            ) : (
              <>
                <span><strong className="text-slate-900">{todayStrip.workers}</strong> <span className="text-slate-500">workers</span></span>
                <span><strong className="text-slate-900">{todayStrip.activitiesTouched}</strong> <span className="text-slate-500">activities touched</span></span>
                <span><strong className="text-slate-900">{todayStrip.photos}</strong> <span className="text-slate-500">photos</span></span>
                <span><strong className="text-slate-900">{todayStrip.receipts}</strong> <span className="text-slate-500">material receipts</span></span>
                <span className="text-slate-500">
                  MB: {todayStrip.mbSheet ? <strong className="text-emerald-700">sheet {todayStrip.mbSheet}</strong> : <span className="text-amber-600">not yet</span>}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Progress S-curve — planned vs actual</CardTitle>
          </CardHeader>
          <CardContent>
            <SCurve points={scurve} todayIso={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fund pipeline</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Where the money sits — the black marker shows work actually done.{" "}
              <Link href={`/dashboard/${siteId}/approvals`} className="text-brand-700 underline">
                Open approvals →
              </Link>
            </p>
          </CardHeader>
          <CardContent>
            <FundFlowBar stages={funds.stages} workDonePct={nowPoint ? nowPoint.actual! : null} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Delay heat by main activity</CardTitle>
          <p className="mt-1 text-xs text-slate-500">Blue = ahead of plan, red = behind. Click a cell to see the trailing items.</p>
        </CardHeader>
        <CardContent>
          <DelayHeatmap rows={heatRows} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Manpower on site</CardTitle>
            <div className="flex gap-1">
              {[...RANGES].sort((a, b) => a.days - b.days).map((r) => (
                <Link
                  key={r.key}
                  href={`/dashboard/${siteId}?range=${r.key}`}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    rangeDays === r.days
                      ? "border-brand-300 bg-brand-50 font-medium text-brand-800"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ManpowerChart days={manpower} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open audit flags</CardTitle>
          </CardHeader>
          <CardContent>
            <FlagList
              flags={flags.map((flag) => ({
                id: flag.id,
                rule: flag.rule,
                severity: flag.severity,
                status: flag.status,
                title:
                  ((flag.details as Record<string, unknown>).materialName as string) ??
                  ((flag.details as Record<string, unknown>).activityCode as string) ??
                  flag.subjectType,
                detail: flagDetail(flag.details as Record<string, unknown>),
                createdAt: flag.createdAt.toISOString(),
                reviewNote: flag.reviewNote,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest progress</CardTitle>
          </CardHeader>
          <CardContent>
            {recentProgress.length === 0 ? (
              <EmptyState title="No entries this week" hint="Engineers record progress from the site app" />
            ) : (
              <div className="space-y-2">
                {recentProgress.map((entry) => {
                  const activity = activityById.get(entry.activityId);
                  return (
                    <div key={entry.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium text-slate-800">{activity?.code ?? "?"}</span>{" "}
                        <span className="text-slate-500">{activity?.name}</span>
                        <p className="text-xs text-slate-400">
                          {dateOnly(entry.entryDate)} · {entry.executedBy === "dept" ? "departmental" : entry.contractorName}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-700">
                        {formatQty(entry.qtyDone.toString(), entry.unit as Unit)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-right text-xs text-slate-400">
        <Link href={`/dashboard/${siteId}/flash`} className="underline hover:text-slate-600">
          Weekly one-page flash report →
        </Link>
      </p>
    </div>
  );
}
