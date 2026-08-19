import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { labourReport } from "@/lib/reports/labour";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";
import { formatINR } from "@/lib/format/inr";
import { BenchmarkEditor } from "./benchmark-editor";

export default async function LabourPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [lines, workTypes, benchmarks] = await Promise.all([
    labourReport(siteId),
    prisma.workType.findMany({ orderBy: { name: "asc" } }),
    prisma.benchmarkRate.findMany({ orderBy: { effectiveFrom: "desc" } }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Departmental labour output & cost audit</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <EmptyState title="No labour entries yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Work</Th>
                  <Th>Type</Th>
                  <Th>When</Th>
                  <Th className="text-right">Crew</Th>
                  <Th className="text-right">Output</Th>
                  <Th className="text-right">Total cost</Th>
                  <Th className="text-right">₹/unit vs benchmark</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.entityId}>
                    <Td>
                      <span className="font-medium">{line.workTypeName}</span>
                      {line.contractorName ? (
                        <p className="text-xs text-slate-400">{line.contractorName}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={line.entryType === "day_rate" ? "blue" : "neutral"}>
                        {line.entryType === "day_rate" ? "day" : "period"}
                      </Badge>
                      {line.open ? (
                        <Badge tone="amber" className="ml-1">
                          open
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs">{line.periodLabel}</Td>
                    <Td className="text-right">
                      {line.workersCount} × ₹{line.rate.toLocaleString("en-IN")}
                      <span className="text-xs text-slate-400">
                        {line.rateBasis === "per_day" ? "/day" : "/unit"}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {line.outputQty !== null
                        ? `${line.outputQty.toLocaleString("en-IN")} ${line.outputUnit ?? ""}`
                        : "—"}
                    </Td>
                    <Td className="text-right font-medium">{formatINR(line.totalCost)}</Td>
                    <Td className="text-right">
                      {line.costPerUnit === null ? (
                        <span className="text-xs text-slate-400">no output yet</span>
                      ) : line.benchmarkCostPerUnit === null ? (
                        <span className="text-xs text-slate-400">
                          ₹{line.costPerUnit.toFixed(0)} · no benchmark set
                        </span>
                      ) : line.overrunPct !== null && line.overrunPct > 0 ? (
                        <Badge tone={line.overrunPct > 20 ? "red" : "amber"}>
                          ₹{line.costPerUnit.toFixed(0)} (+{line.overrunPct}%)
                        </Badge>
                      ) : (
                        <Badge tone="green">₹{line.costPerUnit.toFixed(0)}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BenchmarkEditor
        workTypes={workTypes.map((w) => ({ id: w.id, name: w.name, defaultUnit: w.defaultUnit }))}
        benchmarks={benchmarks.map((b) => ({
          id: b.id,
          workTypeId: b.workTypeId,
          unit: b.unit,
          cost: Number(b.benchmarkCostPerUnit),
          effectiveFrom: b.effectiveFrom.toISOString().slice(0, 10),
        }))}
      />
    </div>
  );
}
