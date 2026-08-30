import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { businessDateIST } from "@/lib/versioning/day-close";
import { Card, CardContent } from "@/components/ui";
import { SCurve } from "@/components/viz/SCurve";
import { formatINRCompact } from "@/lib/format/inr";
import {
  sCurve,
  fundPipeline,
  manpowerSeries,
  todayOnSite,
  lastUpdateAgeDays,
} from "@/lib/reports/dashboard";
import { PrintButton } from "./print-button";

// Weekly flash: ONE page, seven KPIs, identical layout every week so the
// owner scans it by muscle memory. Print-friendly (browser print → PDF).

export default async function FlashReport({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);
  const today = businessDateIST();
  const now = new Date();

  const [site, scurve, funds, manpower, strip, ageDays, flags, siteEntityIds] = await Promise.all([
    prisma.site.findUniqueOrThrow({ where: { id: siteId } }),
    sCurve(siteId, today),
    fundPipeline(siteId),
    manpowerSeries(siteId, today, 7),
    todayOnSite(siteId, today),
    lastUpdateAgeDays(siteId, now),
    prisma.auditFlag.count({ where: { siteId, status: "open" } }),
    prisma.requisition.findMany({ where: { siteId }, select: { entityId: true }, distinct: ["entityId"] }),
  ]);
  const releasedWeekCount = await prisma.approvalAction.count({
    where: {
      action: "released",
      createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) },
      requisitionEntityId: { in: siteEntityIds.map((r) => r.entityId) },
    },
  });

  const withActual = scurve.filter((p) => p.actual !== null);
  const nowPoint = withActual[withActual.length - 1];
  const prevWeek = withActual[withActual.length - 2];
  const gapPp = nowPoint ? nowPoint.actual! - nowPoint.planned : null;
  const weekProgress = nowPoint && prevWeek ? nowPoint.actual! - prevWeek.actual! : null;
  const avgWorkers = manpower.length
    ? Math.round(manpower.reduce((s, d) => s + d.workers, 0) / manpower.filter((d) => d.workers > 0).length || 0)
    : 0;
  const released = funds.stages[0]?.amount ?? 0;
  const pending = funds.stages.slice(1).reduce((s, st) => s + st.amount, 0);

  const kpis: Array<{ label: string; value: string; note: string; bad?: boolean }> = [
    {
      label: "Progress",
      value: nowPoint ? `${nowPoint.actual!.toFixed(0)}%` : "—",
      note: nowPoint ? `planned ${nowPoint.planned.toFixed(0)}%` : "no baseline",
    },
    {
      label: "Schedule gap",
      value: gapPp === null ? "—" : `${gapPp >= 0 ? "+" : "−"}${Math.abs(gapPp).toFixed(1)} pp`,
      note: gapPp === null ? "" : gapPp >= 0 ? "ahead of plan" : "behind plan",
      bad: gapPp !== null && gapPp < -5,
    },
    {
      label: "This week",
      value: weekProgress === null ? "—" : `+${Math.max(0, weekProgress).toFixed(1)} pp`,
      note: "progress added",
    },
    {
      label: "Funds released",
      value: formatINRCompact(released),
      note: `${releasedWeekCount} release action(s) in 7d`,
    },
    {
      label: "Pipeline pending",
      value: formatINRCompact(pending),
      note: "awaiting approval/release",
    },
    {
      label: "Avg manpower",
      value: String(avgWorkers || "—"),
      note: "workers/working day, 7d",
    },
    {
      label: "Open flags",
      value: String(flags),
      note: flags > 0 ? "needs review" : "clear",
      bad: flags > 0,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none">
      <div className="flex items-end justify-between border-b border-slate-300 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{site.name} — weekly flash</h1>
          <p className="text-xs text-slate-500">
            Week ending {new Date(today).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
            {ageDays === 0 ? "site reported today" : ageDays === null ? "no records yet" : `last site update ${ageDays}d ago`}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-7 sm:gap-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="px-3 pt-3 pb-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
              <p className={`mt-0.5 text-xl font-semibold ${k.bad ? "text-red-600" : "text-slate-900"}`}>{k.value}</p>
              <p className="text-[10px] text-slate-500">{k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          <SCurve points={scurve} todayIso={today} />
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-slate-400">
        {todayOnSiteLine(strip)} · Generated {new Date().toLocaleString("en-IN")} · same layout every week
      </p>
    </div>
  );
}

function todayOnSiteLine(strip: Awaited<ReturnType<typeof todayOnSite>>): string {
  if (strip.quiet) return "No site activity recorded today";
  return `Today: ${strip.workers} workers, ${strip.activitiesTouched} activities, ${strip.photos} photos${strip.mbSheet ? `, MB sheet ${strip.mbSheet}` : ""}`;
}
