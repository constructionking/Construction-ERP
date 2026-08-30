import Link from "next/link";
import { prisma } from "@/lib/db";
import { businessDateIST } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState, Table, Th, Td } from "@/components/ui";
import { KpiCard, type Rag } from "@/components/viz/KpiCard";
import { Sparkline } from "@/components/viz/Sparkline";
import { formatINRCompact } from "@/lib/format/inr";
import {
  approvalInbox,
  overallProgressPct,
  progressTrend,
  lastUpdateAgeDays,
  fundPipeline,
} from "@/lib/reports/dashboard";
import { NewSiteForm } from "./new-site-form";

// Owner home, organized around the three questions that matter:
// on time? on budget? under control? — then the approval inbox (₹-sorted,
// age-bucketed) and one RAG row per site drilling into its dashboard.

export default async function DashboardIndex() {
  const today = businessDateIST();
  const now = new Date();
  const sites = await prisma.site.findMany({ orderBy: { name: "asc" } });

  const [flagCounts, inbox] = await Promise.all([
    prisma.auditFlag.groupBy({
      by: ["siteId", "severity"],
      where: { status: "open" },
      _count: true,
    }),
    approvalInbox(now),
  ]);

  const perSite = await Promise.all(
    sites.map(async (site) => {
      const activityIds = (
        await prisma.activity.findMany({ where: { siteId: site.id }, select: { id: true } })
      ).map((a) => a.id);
      const [pct, trend, ageDays, funds, forecasts] = await Promise.all([
        overallProgressPct(site.id, today),
        progressTrend(site.id, today),
        lastUpdateAgeDays(site.id, now),
        fundPipeline(site.id),
        prisma.activityForecast.findMany({
          where: { activityId: { in: activityIds } },
          select: { slipPct: true },
        }),
      ]);
      const worstSlip = forecasts.reduce((m, f) => Math.max(m, Number(f.slipPct ?? 0)), 0);
      const released = funds.stages[0]?.amount ?? 0;
      const pendingAmount = funds.stages.slice(1).reduce((s, st) => s + st.amount, 0);
      return { site, pct, trend, ageDays, worstSlip, released, pendingAmount };
    }),
  );

  const openBySite = new Map<string, { warn: number; critical: number }>();
  for (const row of flagCounts) {
    const entry = openBySite.get(row.siteId) ?? { warn: 0, critical: 0 };
    if (row.severity === "critical") entry.critical += row._count;
    else entry.warn += row._count;
    openBySite.set(row.siteId, entry);
  }

  // The three questions, portfolio-level.
  const worstSlipAll = perSite.reduce((m, s) => Math.max(m, s.worstSlip), 0);
  const onTimeRag: Rag = worstSlipAll > 25 ? "critical" : worstSlipAll > 10 ? "serious" : "good";
  const withYou = inbox.filter((r) => r.blockedOn === "you");
  const withYouAmount = withYou.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalReleased = perSite.reduce((s, x) => s + x.released, 0);
  const budgetRag: Rag = withYou.some((r) => r.bucket === "overdue") ? "serious" : withYou.length ? "warning" : "good";
  const criticalFlags = [...openBySite.values()].reduce((s, f) => s + f.critical, 0);
  const warnFlags = [...openBySite.values()].reduce((s, f) => s + f.warn, 0);
  const controlRag: Rag = criticalFlags > 0 ? "critical" : warnFlags > 0 ? "warning" : "good";
  const staleSites = perSite.filter((s) => (s.ageDays ?? 99) > 1).length;

  const bucketTone = { overdue: "red", week: "amber", later: "neutral" } as const;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Your sites</h1>

      {sites.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="On time?"
            value={worstSlipAll > 0 ? `+${worstSlipAll.toFixed(0)}% slip` : "On schedule"}
            sub={worstSlipAll > 10 ? "worst contractor slip past the 10% threshold" : "all forecasts within tolerance"}
            rag={onTimeRag}
          />
          <KpiCard
            label="On budget?"
            value={withYou.length ? `${formatINRCompact(withYouAmount)} with you` : "Nothing waiting"}
            sub={`${formatINRCompact(totalReleased)} released to date · ${withYou.length} approval${withYou.length === 1 ? "" : "s"} on your desk`}
            rag={budgetRag}
          />
          <KpiCard
            label="Under control?"
            value={criticalFlags > 0 ? `${criticalFlags} critical` : warnFlags > 0 ? `${warnFlags} flags` : "Clear"}
            sub={staleSites > 0 ? `${staleSites} site${staleSites === 1 ? "" : "s"} silent >24h` : "every site reported today"}
            rag={controlRag}
          />
        </div>
      ) : null}

      {inbox.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Approval inbox</CardTitle>
            <p className="mt-1 text-xs text-slate-500">Largest amounts first — age shows who is waiting on whom.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inbox.slice(0, 8).map((row, i) => (
                <Link
                  key={i}
                  href={`/dashboard/${row.siteId}/approvals`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">
                      {row.amount !== null ? formatINRCompact(row.amount) : "Material"}
                    </span>{" "}
                    <span className="text-slate-500">
                      · {row.siteName} · {row.justification.slice(0, 60)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={row.blockedOn === "you" ? "blue" : "neutral"}>
                      {row.blockedOn === "you" ? "your call" : "with accounts"}
                    </Badge>
                    <Badge tone={bucketTone[row.bucket]}>
                      {row.waitingDays === 0 ? "today" : `${row.waitingDays}d`}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {sites.length === 0 ? (
        <EmptyState title="No sites yet" hint="Create your first site below" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th>Site</Th>
                  <Th className="text-right">Progress</Th>
                  <Th>Trend</Th>
                  <Th className="text-right">Slip</Th>
                  <Th className="text-right">Released</Th>
                  <Th className="text-right">Pending ₹</Th>
                  <Th>Flags</Th>
                  <Th>Last update</Th>
                </tr>
              </thead>
              <tbody>
                {perSite.map(({ site, pct, trend, ageDays, worstSlip, released, pendingAmount }) => {
                  const flags = openBySite.get(site.id);
                  const rag: Rag =
                    (flags?.critical ?? 0) > 0 || worstSlip > 25
                      ? "critical"
                      : worstSlip > 10 || (flags?.warn ?? 0) > 0
                        ? "serious"
                        : (ageDays ?? 0) > 1
                          ? "warning"
                          : "good";
                  const ragColor = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" }[rag!];
                  return (
                    <tr key={site.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/dashboard/${site.id}`} className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ragColor }} />
                          {site.name}
                          <span className="text-xs font-normal text-slate-400">{site.code}</span>
                        </Link>
                      </Td>
                      <Td className="text-right font-semibold text-slate-800">
                        {pct !== null ? `${pct.toFixed(0)}%` : "—"}
                      </Td>
                      <Td>{trend.length >= 2 ? <Sparkline points={trend} width={72} height={22} /> : <span className="text-xs text-slate-400">no baseline</span>}</Td>
                      <Td className="text-right">
                        {worstSlip > 0 ? (
                          <span className={worstSlip > 10 ? "font-semibold text-red-600" : "text-amber-600"}>
                            +{worstSlip.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-emerald-600">—</span>
                        )}
                      </Td>
                      <Td className="text-right text-slate-700">{released > 0 ? formatINRCompact(released) : "—"}</Td>
                      <Td className="text-right text-slate-700">{pendingAmount > 0 ? formatINRCompact(pendingAmount) : "—"}</Td>
                      <Td>
                        {flags?.critical ? <Badge tone="red">{flags.critical} critical</Badge> : null}{" "}
                        {flags?.warn ? <Badge tone="amber">{flags.warn}</Badge> : null}
                        {!flags ? <span className="text-xs text-emerald-600">clear</span> : null}
                      </Td>
                      <Td>
                        {ageDays === null ? (
                          <span className="text-xs text-slate-400">never</span>
                        ) : ageDays === 0 ? (
                          <span className="text-xs text-emerald-600">today</span>
                        ) : (
                          <span className={`text-xs ${ageDays > 1 ? "font-medium text-amber-600" : "text-slate-500"}`}>
                            {ageDays}d ago
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      <NewSiteForm />
    </div>
  );
}
