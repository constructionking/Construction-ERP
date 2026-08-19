import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { FlagList } from "@/components/FlagList";
import { formatQty } from "@/lib/format/units";
import type { Unit } from "@prisma/client";

function flagDetail(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([key]) => !["activityId", "materialId", "estimateId", "requisitionEntityId", "workTypeId"].includes(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

export default async function SiteOverview({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []); // owner-only via layout; extra safety

  const today = businessDateIST();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [activities, progressTotals, forecasts, flags, pendingReqs, recentProgress, photosCount, mbToday] =
    await Promise.all([
      prisma.activity.findMany({ where: { siteId } }),
      prisma.progressEntry.groupBy({
        by: ["activityId"],
        where: { siteId, isCurrent: true, status: "submitted" },
        _sum: { qtyDone: true },
      }),
      prisma.activityForecast.findMany({
        where: { activityId: { in: (await prisma.activity.findMany({ where: { siteId }, select: { id: true } })).map((a) => a.id) } },
      }),
      prisma.auditFlag.findMany({
        where: { siteId, status: "open" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.requisition.findMany({
        where: { siteId, isCurrent: true, status: "submitted" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.progressEntry.findMany({
        where: { siteId, isCurrent: true, status: "submitted", createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      prisma.photo.count({ where: { siteId, createdAt: { gte: weekAgo } } }),
      prisma.measurementBook.findFirst({
        where: { siteId, isCurrent: true, mbDate: new Date(today) },
      }),
    ]);

  const actioned = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: { in: pendingReqs.map((r) => r.entityId) } },
    orderBy: { createdAt: "desc" },
  });
  const latestAction = new Map<string, (typeof actioned)[number]>();
  for (const action of actioned) {
    if (!latestAction.has(action.requisitionEntityId)) latestAction.set(action.requisitionEntityId, action);
  }
  const awaiting = pendingReqs.filter((r) => {
    const act = latestAction.get(r.entityId);
    return !act || act.action === "queried" || r.createdAt > act.createdAt;
  });

  // Weighted overall progress: Σ min(done, boq) / Σ boq over activities with BOQ.
  const doneByActivity = new Map(progressTotals.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)]));
  let boqSum = 0;
  let doneSum = 0;
  for (const activity of activities) {
    const boq = Number(activity.boqQty ?? 0);
    if (boq <= 0) continue;
    boqSum += boq;
    doneSum += Math.min(boq, doneByActivity.get(activity.id) ?? 0);
  }
  const overallPct = boqSum > 0 ? (doneSum / boqSum) * 100 : 0;

  const worstSlip = forecasts.reduce(
    (max, f) => Math.max(max, Number(f.slipPct ?? 0)),
    0
  );
  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const kpis = [
    {
      label: "Overall progress",
      value: `${overallPct.toFixed(0)}%`,
      sub: boqSum > 0 ? "BOQ-weighted across activities" : "set BOQ quantities in Setup",
      tone: "text-brand-700",
    },
    {
      label: "Worst forecast slip",
      value: worstSlip > 0 ? `+${worstSlip.toFixed(0)}%` : "on time",
      sub: worstSlip > 10 ? "over the 10% delay threshold" : "within tolerance",
      tone: worstSlip > 10 ? "text-red-600" : "text-emerald-600",
    },
    {
      label: "Open flags",
      value: String(flags.length),
      sub: criticalCount ? `${criticalCount} critical` : "none critical",
      tone: criticalCount ? "text-red-600" : flags.length ? "text-amber-600" : "text-emerald-600",
    },
    {
      label: "Awaiting approval",
      value: String(awaiting.length),
      sub: "requisitions pending a decision",
      tone: awaiting.length ? "text-amber-600" : "text-emerald-600",
    },
    {
      label: "This week",
      value: String(recentProgress.length),
      sub: `progress entries · ${photosCount} photos`,
      tone: "text-slate-700",
    },
    {
      label: `MB for ${today}`,
      value: mbToday ? "uploaded" : "—",
      sub: mbToday ? `sheet ${mbToday.sheetNo}` : "not uploaded yet",
      tone: mbToday ? "text-emerald-600" : "text-slate-400",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {kpi.label}
              </p>
              <p className={`mt-1 text-2xl font-semibold ${kpi.tone}`}>{kpi.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

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
              <EmptyState title="No entries this week" />
            ) : (
              <div className="space-y-2">
                {recentProgress.map((entry) => {
                  const activity = activityById.get(entry.activityId);
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium text-slate-800">
                          {activity?.code ?? "?"}
                        </span>{" "}
                        <span className="text-slate-500">{activity?.name}</span>
                        <p className="text-xs text-slate-400">
                          {dateOnly(entry.entryDate)} ·{" "}
                          {entry.executedBy === "dept" ? "departmental" : entry.contractorName}
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
    </div>
  );
}
