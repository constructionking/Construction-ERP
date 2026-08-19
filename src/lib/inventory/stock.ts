import { prisma } from "@/lib/db";

export interface StockLine {
  materialId: string;
  name: string;
  unit: string;
  category: string;
  received: number;
  consumed: number;
  balance: number;
  lastScanQty: number | null;
  lastScanAt: string | null;
  scanVariancePct: number | null;
}

/**
 * Running stock is COMPUTED from the ledger (current submitted receipts minus
 * current submitted consumption), never stored as a mutable balance — the
 * ledger stays the single source of truth. The latest accepted/decided scan
 * per material is reported beside it as a physical cross-check.
 */
export async function computeSiteStock(siteId: string): Promise<StockLine[]> {
  const [received, consumed, materials, scans] = await Promise.all([
    prisma.materialReceipt.groupBy({
      by: ["materialId"],
      where: { siteId, isCurrent: true, status: "submitted" },
      _sum: { qty: true },
    }),
    prisma.consumptionEntry.groupBy({
      by: ["materialId"],
      where: { siteId, isCurrent: true, status: "submitted" },
      _sum: { qty: true },
    }),
    prisma.material.findMany({ where: { active: true } }),
    prisma.stockpileScan.findMany({
      where: { siteId, status: { in: ["accepted", "rejected"] } },
      orderBy: { createdAt: "desc" },
      include: { result: true, decision: true },
    }),
  ]);

  const receivedBy = new Map(received.map((r) => [r.materialId, Number(r._sum.qty ?? 0)]));
  const consumedBy = new Map(consumed.map((c) => [c.materialId, Number(c._sum.qty ?? 0)]));

  const latestScanBy = new Map<string, (typeof scans)[number]>();
  for (const scan of scans) {
    if (!latestScanBy.has(scan.materialId)) latestScanBy.set(scan.materialId, scan);
  }

  return materials
    .map((material) => {
      const rec = receivedBy.get(material.id) ?? 0;
      const con = consumedBy.get(material.id) ?? 0;
      const scan = latestScanBy.get(material.id);
      // The authoritative physical qty from a scan: engineer's figure when the
      // scan was rejected, otherwise the accepted computed qty.
      const scanQty = scan
        ? scan.decision?.decision === "rejected"
          ? Number(scan.decision.engineerQty ?? 0)
          : Number(scan.result?.computedQty ?? 0)
        : null;
      const balance = rec - con;
      return {
        materialId: material.id,
        name: material.name,
        unit: material.unit,
        category: material.category,
        received: rec,
        consumed: con,
        balance,
        lastScanQty: scanQty,
        lastScanAt: scan ? scan.createdAt.toISOString() : null,
        scanVariancePct:
          scanQty !== null && balance > 0
            ? Number((((scanQty - balance) / balance) * 100).toFixed(1))
            : null,
      };
    })
    .filter((line) => line.received > 0 || line.consumed > 0 || line.lastScanQty !== null);
}
