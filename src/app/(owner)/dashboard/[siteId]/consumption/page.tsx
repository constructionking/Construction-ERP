import Link from "next/link";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { consumptionReport, type ActivityBlock } from "@/lib/reports/consumption";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";
import { formatQty } from "@/lib/format/units";
import { SERIES, STATUS } from "@/components/viz/palette";
import { cn } from "@/lib/cn";
import type { Unit } from "@prisma/client";

const RANGES: Array<{ key: string; label: string; days: number | null }> = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "Whole project", days: null },
];

function VarianceBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400">no norm</span>;
  if (pct > 25) return <Badge tone="red">+{pct}%</Badge>;
  if (pct > 10) return <Badge tone="amber">+{pct}%</Badge>;
  return (
    <Badge tone="green">
      {pct > 0 ? "+" : ""}
      {pct}%
    </Badge>
  );
}

// Norm vs actual as two thin bars on one scale — the eye reads the overshoot
// before the number does.
function NormBar({ theoretical, actual, pct }: { theoretical: number; actual: number; pct: number | null }) {
  const max = Math.max(theoretical, actual, 1);
  const color = pct === null ? SERIES.s1 : pct > 25 ? STATUS.critical : pct > 10 ? STATUS.warning : STATUS.good;
  return (
    <div className="w-40 space-y-0.5" aria-hidden>
      <div className="h-1.5 rounded-sm bg-slate-100">
        <div className="h-1.5 rounded-sm" style={{ width: `${(theoretical / max) * 100}%`, background: "#cbd5e1" }} />
      </div>
      <div className="h-1.5 rounded-sm bg-slate-100">
        <div className="h-1.5 rounded-sm" style={{ width: `${(actual / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export default async function ConsumptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { siteId } = await params;
  const { range } = await searchParams;
  await requireSiteRolePage(siteId, []);

  const selected = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const from = selected.days ? new Date(Date.now() - selected.days * 86_400_000) : undefined;
  const report = await consumptionReport(siteId, { from });

  // Group activity blocks under their main activity, keeping worst-first order inside.
  const byParent = new Map<string, ActivityBlock[]>();
  for (const block of report.activities) {
    const key = block.parentName ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), block]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Theoretical = mix norm × work recorded · Actual = engineers&apos; daily consumption
          reports · {report.reportCount} report{report.reportCount === 1 ? "" : "s"} in this period.
        </p>
        <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`?range=${r.key}`}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium",
                r.key === selected.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              )}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By material — theoretical vs actual</CardTitle>
        </CardHeader>
        <CardContent>
          {report.materials.length === 0 ? (
            <EmptyState
              title="No consumption reported in this period"
              hint="Engineers file a daily consumption report from Stock → Consume; theoretical vs actual appears here"
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th className="text-right">Theoretical</Th>
                  <Th className="text-right">Actual</Th>
                  <Th>Norm vs actual</Th>
                  <Th className="text-right">Variance</Th>
                </tr>
              </thead>
              <tbody>
                {report.materials.map((m) => (
                  <tr key={m.materialId}>
                    <Td>
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-1.5 text-xs text-slate-400">{m.category}</span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {m.theoretical > 0 ? formatQty(m.theoretical, m.unit as Unit) : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQty(m.actual, m.unit as Unit)}
                      {m.actual > m.actualAgainstNorm ? (
                        <span className="block text-[11px] text-slate-400">
                          {formatQty(m.actual - m.actualAgainstNorm, m.unit as Unit)} without a mix norm
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <NormBar theoretical={m.theoretical} actual={m.actualAgainstNorm} pct={m.variancePct} />
                    </Td>
                    <Td className="text-right">
                      <VarianceBadge pct={m.variancePct} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Grey bar = theoretical, coloured bar = actual booked on mix-linked work. Over 10% is amber,
            over 25% red — the same thresholds that raise audit flags. TBD mixes carry no norm.
          </p>
        </CardContent>
      </Card>

      {[...byParent.entries()].map(([parentName, blocks]) => (
        <Card key={parentName || "__ungrouped"}>
          <CardHeader>
            <CardTitle>{parentName || "Items not under a main activity"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {blocks.map((b) => (
              <div key={b.activityId} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{b.activityCode}</span>
                  <span className="text-slate-600">{b.activityName}</span>
                  <span className="text-xs text-slate-400">
                    · {b.mixName ?? "no mix"}
                    {b.mixStatus === "provisional" ? " (prov.)" : b.mixStatus === "tbd" ? " (rate TBD)" : ""}
                    · work {b.progressQty.toLocaleString("en-IN")} {b.outputUnit}
                  </span>
                  <span className="ml-auto">
                    <VarianceBadge pct={b.worstVariancePct} />
                  </span>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th>Material</Th>
                      <Th className="text-right">Theoretical</Th>
                      <Th className="text-right">Actual</Th>
                      <Th className="text-right">Variance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.materialId}>
                        <Td>{l.materialName}</Td>
                        <Td className="text-right tabular-nums">
                          {l.theoretical === null ? <span className="text-slate-400">—</span> : formatQty(l.theoretical, l.unit as Unit)}
                        </Td>
                        <Td className="text-right tabular-nums">{formatQty(l.actual, l.unit as Unit)}</Td>
                        <Td className="text-right">
                          <VarianceBadge pct={l.variancePct} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
