import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { computeSiteStock } from "@/lib/inventory/stock";
import { dateOnly } from "@/lib/versioning/day-close";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";

export default async function InventoryReportPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [stock, qualityIssues, materials] = await Promise.all([
    computeSiteStock(siteId),
    prisma.materialReceipt.findMany({
      where: { siteId, isCurrent: true, status: "submitted", qualityAdequate: false },
      orderBy: { receivedDate: "desc" },
      take: 20,
    }),
    prisma.material.findMany(),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Running stock (book balance vs latest physical scan)</CardTitle>
        </CardHeader>
        <CardContent>
          {stock.length === 0 ? (
            <EmptyState title="No stock movement yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Consumed</Th>
                  <Th className="text-right">Book balance</Th>
                  <Th className="text-right">Last scan</Th>
                  <Th className="text-right">Scan vs book</Th>
                </tr>
              </thead>
              <tbody>
                {stock.map((line) => (
                  <tr key={line.materialId}>
                    <Td className="font-medium">
                      {line.name} <span className="text-xs text-slate-400">{line.unit}</span>
                    </Td>
                    <Td className="text-right">{line.received.toLocaleString("en-IN")}</Td>
                    <Td className="text-right">{line.consumed.toLocaleString("en-IN")}</Td>
                    <Td className="text-right font-semibold">
                      {line.balance.toLocaleString("en-IN")}
                    </Td>
                    <Td className="text-right">
                      {line.lastScanQty !== null ? line.lastScanQty.toLocaleString("en-IN") : "—"}
                    </Td>
                    <Td className="text-right">
                      {line.scanVariancePct === null ? (
                        <span className="text-slate-400">—</span>
                      ) : Math.abs(line.scanVariancePct) > 10 ? (
                        <Badge tone="red">
                          {line.scanVariancePct > 0 ? "+" : ""}
                          {line.scanVariancePct}%
                        </Badge>
                      ) : (
                        <Badge tone="green">
                          {line.scanVariancePct > 0 ? "+" : ""}
                          {line.scanVariancePct}%
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

      <Card>
        <CardHeader>
          <CardTitle>Quality issues on receipt</CardTitle>
        </CardHeader>
        <CardContent>
          {qualityIssues.length === 0 ? (
            <EmptyState title="No quality-flagged receipts" />
          ) : (
            <div className="space-y-2">
              {qualityIssues.map((receipt) => (
                <div
                  key={receipt.id}
                  className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2.5 text-sm"
                >
                  <p className="font-medium text-slate-800">
                    {materialById.get(receipt.materialId)?.name ?? "Material"} ·{" "}
                    {Number(receipt.qty).toLocaleString("en-IN")} {receipt.unit}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateOnly(receipt.receivedDate)} · {receipt.supplier} · Ch.{" "}
                    {receipt.challanNo}
                  </p>
                  {receipt.qualityRemarks ? (
                    <p className="mt-1 text-xs text-red-700">{receipt.qualityRemarks}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
