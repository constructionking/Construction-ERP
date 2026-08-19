import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { consumptionReport } from "@/lib/reports/consumption";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";
import { formatQty } from "@/lib/format/units";
import type { Unit } from "@prisma/client";

export default async function ConsumptionPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);
  const lines = await consumptionReport(siteId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumption vs mix-design norms (live audit)</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <EmptyState
            title="No mix-linked consumption yet"
            hint="When engineers record consumption against a mix, theoretical vs actual appears here in real time"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Activity</Th>
                <Th>Mix</Th>
                <Th>Material</Th>
                <Th className="text-right">Work done</Th>
                <Th className="text-right">Theoretical</Th>
                <Th className="text-right">Actual</Th>
                <Th className="text-right">Variance</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <Td>
                    <span className="font-medium">{line.activityCode}</span>{" "}
                    <span className="text-slate-500">{line.activityName}</span>
                  </Td>
                  <Td>{line.mixCode}</Td>
                  <Td>{line.materialName}</Td>
                  <Td className="text-right">{line.progressQty.toLocaleString("en-IN")} cum</Td>
                  <Td className="text-right">
                    {formatQty(line.theoretical, line.unit as Unit)}
                  </Td>
                  <Td className="text-right">{formatQty(line.actual, line.unit as Unit)}</Td>
                  <Td className="text-right">
                    {line.variancePct === null ? (
                      <span className="text-slate-400">—</span>
                    ) : line.variancePct > 25 ? (
                      <Badge tone="red">+{line.variancePct}%</Badge>
                    ) : line.variancePct > 10 ? (
                      <Badge tone="amber">+{line.variancePct}%</Badge>
                    ) : (
                      <Badge tone="green">
                        {line.variancePct > 0 ? "+" : ""}
                        {line.variancePct}%
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
