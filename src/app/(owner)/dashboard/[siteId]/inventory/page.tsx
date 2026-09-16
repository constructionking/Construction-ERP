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

  // Stock grouped under the category the item belongs to — cement, sand,
  // aggregate, brick, steel, tools & equipment, consumables, other.
  const CATEGORY_ORDER = ["cement", "sand", "aggregate", "brick", "steel", "tool", "consumable", "other"];
  const CATEGORY_LABELS: Record<string, string> = {
    cement: "Cement",
    sand: "Sand",
    aggregate: "Aggregate",
    brick: "Bricks & blocks",
    steel: "Steel",
    tool: "Tools & equipment",
    consumable: "Consumables",
    other: "Other",
  };
  const byCategory = new Map<string, typeof stock>();
  for (const line of stock) {
    byCategory.set(line.category, [...(byCategory.get(line.category) ?? []), line]);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Running stock (book balance vs latest physical scan)</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Everything received at site — including items engineers requested by name once you
            approved them — grouped by category.
          </p>
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
                {orderedCategories.flatMap((category) => [
                  <tr key={`cat-${category}`} className="bg-slate-50">
                    <Td colSpan={6} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {CATEGORY_LABELS[category] ?? category}
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
                        {byCategory.get(category)!.length} item{byCategory.get(category)!.length === 1 ? "" : "s"}
                      </span>
                    </Td>
                  </tr>,
                  ...byCategory.get(category)!.map((line) => (
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
                  )),
                ])}
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
