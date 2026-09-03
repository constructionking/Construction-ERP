import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { getCurrentBaseline } from "@/lib/schedule/service";
import { dateOnly } from "@/lib/versioning/day-close";
import { formatINR } from "@/lib/format/inr";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";

export default async function ContractorsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [activities, baseline, progressTotals, contractorRates] = await Promise.all([
    prisma.activity.findMany({ where: { siteId, contractorName: { not: null }, isGroup: false } }),
    getCurrentBaseline(siteId),
    prisma.progressEntry.groupBy({
      by: ["activityId"],
      where: { siteId, isCurrent: true, status: "submitted" },
      _sum: { qtyDone: true },
    }),
    prisma.contractorRate.findMany({
      where: { contractor: { siteId }, activityId: { not: null } },
      select: { contractorId: true, activityId: true, rate: true },
    }),
  ]);
  const forecasts = await prisma.activityForecast.findMany({
    where: { activityId: { in: activities.map((a) => a.id) } },
  });

  // Agreed rate for an item under ITS assigned contractor's rate card.
  const rateByContractorActivity = new Map(
    contractorRates.map((r) => [`${r.contractorId}:${r.activityId}`, Number(r.rate)])
  );
  const agreedRate = (activity: { id: string; contractorId: string | null }) =>
    activity.contractorId
      ? rateByContractorActivity.get(`${activity.contractorId}:${activity.id}`) ?? null
      : null;

  const doneByActivity = new Map(
    progressTotals.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)])
  );
  const forecastByActivity = new Map(forecasts.map((f) => [f.activityId, f]));
  const baselineByActivity = new Map(
    (baseline?.activities ?? []).map((b) => [b.activityId, b])
  );

  // Group by contractor
  const byContractor = new Map<string, typeof activities>();
  for (const activity of activities) {
    const list = byContractor.get(activity.contractorName!) ?? [];
    list.push(activity);
    byContractor.set(activity.contractorName!, list);
  }

  return (
    <div className="space-y-4">
      {byContractor.size === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <EmptyState
              title="No contractor-assigned activities"
              hint="Assign a contractor name to activities in Setup to track their output and delays"
            />
          </CardContent>
        </Card>
      ) : (
        [...byContractor.entries()].map(([contractor, list]) => {
          const worstSlip = Math.max(
            0,
            ...list.map((a) => Number(forecastByActivity.get(a.id)?.slipPct ?? 0))
          );
          // Work done value = measured progress × the contractor's agreed rate,
          // the owner's cross-check against RA bills.
          const workValue = list.reduce((sum, a) => {
            const rate = agreedRate(a);
            const done = doneByActivity.get(a.id) ?? 0;
            const boq = Number(a.boqQty ?? 0);
            const cappedDone = boq > 0 ? Math.min(done, boq) : done;
            return rate ? sum + cappedDone * rate : sum;
          }, 0);
          const ratedCount = list.filter((a) => agreedRate(a) !== null).length;
          return (
            <Card key={contractor}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{contractor}</CardTitle>
                  <div className="flex items-center gap-2">
                    {workValue > 0 ? (
                      <Badge tone="blue">{formatINR(workValue)} work done at agreed rates</Badge>
                    ) : null}
                    {worstSlip > 10 ? (
                      <Badge tone={worstSlip > 25 ? "red" : "amber"}>
                        running {worstSlip.toFixed(0)}% behind
                      </Badge>
                    ) : (
                      <Badge tone="green">on schedule</Badge>
                    )}
                  </div>
                </div>
                {ratedCount < list.length ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {list.length - ratedCount} of {list.length} items have no agreed rate yet —
                    fill them in Setup → Contractors &amp; rates for a complete work value.
                  </p>
                ) : null}
              </CardHeader>
              <CardContent>
                <Table>
                  <thead>
                    <tr>
                      <Th>Activity</Th>
                      <Th className="text-right">Done / BOQ</Th>
                      <Th className="text-right">Agreed rate</Th>
                      <Th className="text-right">Work value</Th>
                      <Th>Planned end</Th>
                      <Th>Forecast end</Th>
                      <Th className="text-right">Slip</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((activity) => {
                      const done = doneByActivity.get(activity.id) ?? 0;
                      const boq = Number(activity.boqQty ?? 0);
                      const forecast = forecastByActivity.get(activity.id);
                      const planned = baselineByActivity.get(activity.id);
                      const slip = forecast?.slipPct !== null && forecast ? Number(forecast.slipPct) : null;
                      const rate = agreedRate(activity);
                      const cappedDone = boq > 0 ? Math.min(done, boq) : done;
                      return (
                        <tr key={activity.id}>
                          <Td>
                            <span className="font-medium">{activity.code}</span>{" "}
                            <span className="text-slate-500">{activity.name}</span>
                          </Td>
                          <Td className="text-right">
                            {done.toLocaleString("en-IN")}
                            {boq > 0 ? ` / ${boq.toLocaleString("en-IN")} ${activity.unit ?? ""}` : ""}
                            {boq > 0 ? (
                              <span className="ml-1 text-xs text-slate-400">
                                ({Math.min(100, (done / boq) * 100).toFixed(0)}%)
                              </span>
                            ) : null}
                          </Td>
                          <Td className="text-right">
                            {rate !== null ? (
                              <>
                                {rate.toLocaleString("en-IN")}
                                <span className="text-xs text-slate-400">/{activity.unit ?? "unit"}</span>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </Td>
                          <Td className="text-right">
                            {rate !== null && cappedDone > 0 ? (
                              formatINR(cappedDone * rate)
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </Td>
                          <Td>{planned ? dateOnly(planned.plannedEnd) : "—"}</Td>
                          <Td>{forecast?.forecastEnd ? dateOnly(forecast.forecastEnd) : "—"}</Td>
                          <Td className="text-right">
                            {slip === null ? (
                              <span className="text-slate-400">—</span>
                            ) : slip > 10 ? (
                              <Badge tone={slip > 25 ? "red" : "amber"}>+{slip.toFixed(0)}%</Badge>
                            ) : (
                              <Badge tone="green">{slip > 0 ? `+${slip.toFixed(0)}%` : "on time"}</Badge>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-slate-400">
                  Work value = measured progress × the rate agreed with this contractor (progress
                  capped at BOQ qty) — cross-check it against their RA bill before paying. Slip is
                  flagged automatically past 10% of the allotted duration.
                </p>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
