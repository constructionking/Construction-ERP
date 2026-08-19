import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui";

export default async function ScansReportPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [scans, materials, users] = await Promise.all([
    prisma.stockpileScan.findMany({
      where: { siteId },
      orderBy: { createdAt: "desc" },
      include: { result: true, decision: true, job: true },
      take: 60,
    }),
    prisma.material.findMany(),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan variance report — every scan and verdict</CardTitle>
      </CardHeader>
      <CardContent>
        {scans.length === 0 ? (
          <EmptyState title="No scans yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Material</Th>
                <Th>Method</Th>
                <Th>By</Th>
                <Th className="text-right">Scan qty</Th>
                <Th className="text-right">Engineer qty</Th>
                <Th className="text-right">Variance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => {
                const variance = scan.decision?.variancePct !== null && scan.decision
                  ? Number(scan.decision.variancePct)
                  : null;
                return (
                  <tr key={scan.id}>
                    <Td className="text-xs">
                      {scan.createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </Td>
                    <Td className="font-medium">
                      {materialById.get(scan.materialId)?.name ?? "Material"}
                    </Td>
                    <Td className="text-xs">
                      {scan.method === "photogrammetry" ? "camera" : scan.method}
                      {scan.result?.confidence ? (
                        <span className="text-slate-400">
                          {" "}
                          · {(Number(scan.result.confidence) * 100).toFixed(0)}%
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-xs">{userById.get(scan.createdById)?.name ?? "—"}</Td>
                    <Td className="text-right">
                      {scan.result?.computedQty
                        ? `${Number(scan.result.computedQty).toLocaleString("en-IN")} ${scan.result.qtyUnit}`
                        : "—"}
                    </Td>
                    <Td className="text-right">
                      {scan.decision?.engineerQty
                        ? Number(scan.decision.engineerQty).toLocaleString("en-IN")
                        : scan.decision?.decision === "accepted"
                          ? "accepted as-is"
                          : "—"}
                    </Td>
                    <Td className="text-right">
                      {variance === null ? (
                        <span className="text-slate-400">—</span>
                      ) : Math.abs(variance) > 10 ? (
                        <Badge tone="red">
                          {variance > 0 ? "+" : ""}
                          {variance}%
                        </Badge>
                      ) : (
                        <Badge tone="green">
                          {variance > 0 ? "+" : ""}
                          {variance}%
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          scan.status === "accepted"
                            ? "green"
                            : scan.status === "rejected" || scan.status === "failed"
                              ? "red"
                              : "blue"
                        }
                      >
                        {scan.status}
                      </Badge>
                      {scan.status === "failed" && scan.job?.error ? (
                        <p className="mt-0.5 max-w-48 truncate text-xs text-slate-400">
                          {scan.job.error}
                        </p>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
