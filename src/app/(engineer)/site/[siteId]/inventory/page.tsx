import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { computeSiteStock } from "@/lib/inventory/stock";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { aiEnabled } from "@/lib/ai/client";
import { cumToCft } from "@/lib/telemetry/steel";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { InventoryTabs } from "./inventory-tabs";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const [stock, materials, activities, mixDesigns, receipts, consumption] = await Promise.all([
    computeSiteStock(siteId),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.activity.findMany({
      // Leaves only: consumption is booked against work items, not headings.
      where: { siteId, isGroup: false },
      orderBy: { sequence: "asc" },
      select: { id: true, code: true, name: true, defaultMixId: true, parent: { select: { id: true, name: true } } },
    }),
    prisma.mixDesign.findMany({ orderBy: { code: "asc" }, include: { coefficients: true } }),
    prisma.materialReceipt.findMany({
      where: { siteId, isCurrent: true, status: "submitted" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.consumptionEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const today = businessDateIST();
  // Today's recorded work per activity — pre-fills the report's theoretical column.
  // Owner-approved material demands — receipts are recorded against their lines.
  const approvedDemands = (await listRequisitionsWithState({ siteIds: [siteId], kind: "material" }))
    .filter((r) => r.state === "approved" || r.state === "partially_approved")
    .map((r) => ({
      entityId: r.requisition.entityId,
      createdAt: dateOnly(r.requisition.createdAt),
      lines: (r.requisition.lines as Array<{ item?: string; type?: string; qty: number; unit: string }>).map(
        (l, index) => ({ index, item: l.item ?? "Item", type: l.type ?? "material", qty: l.qty, unit: l.unit })
      ),
    }));
  const [progressToday, recentScans] = await Promise.all([
    prisma.progressEntry.groupBy({
      by: ["activityId"],
      where: { siteId, isCurrent: true, status: "submitted", entryDate: new Date(today) },
      _sum: { qtyDone: true },
    }),
    // Heap scans from the last 3 days — a delivered heap the engineer measured
    // can be pulled straight into the receipt.
    prisma.stockpileScan.findMany({
      where: {
        siteId,
        status: { in: ["computed", "accepted"] },
        createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
      },
      include: { result: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <InventoryTabs
      siteId={siteId}
      today={today}
      stock={stock}
      materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, category: m.category }))}
      activities={activities}
      mixDesigns={mixDesigns.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        outputUnit: m.outputUnit,
        status: m.status,
        coefficients: m.coefficients.map((c) => ({ materialId: c.materialId, qtyPerUnit: Number(c.qtyPerUnit) })),
      }))}
      progressToday={Object.fromEntries(
        progressToday.map((p) => [p.activityId, Number(p._sum.qtyDone ?? 0)])
      )}
      aiAvailable={aiEnabled()}
      approvedDemands={approvedDemands}
      recentScans={recentScans
        .filter((s) => s.result)
        .map((s) => ({
          id: s.id,
          materialId: s.materialId,
          method: s.method,
          volumeCum: Number(s.result!.computedVolumeCum ?? 0),
          volumeCft: cumToCft(Number(s.result!.computedVolumeCum ?? 0)),
          qty: Number(s.result!.computedQty ?? 0),
          unit: s.result!.qtyUnit,
          when: s.createdAt.toISOString(),
        }))}
      receipts={receipts.map((r) => ({
        id: r.id,
        entityId: r.entityId,
        materialId: r.materialId,
        qty: r.qty.toString(),
        unit: r.unit,
        supplier: r.supplier,
        challanNo: r.challanNo,
        qualityAdequate: r.qualityAdequate,
        qualityRemarks: r.qualityRemarks,
        receivedDate: dateOnly(r.receivedDate),
        version: r.version,
        createdToday: businessDateIST(r.createdAt) === today,
        requisitionEntityId: r.requisitionEntityId,
        photoIds: r.photoIds,
      }))}
      consumption={consumption.map((c) => ({
        id: c.id,
        entityId: c.entityId,
        materialId: c.materialId,
        activityId: c.activityId,
        mixDesignId: c.mixDesignId,
        qty: c.qty.toString(),
        entryDate: dateOnly(c.entryDate),
        version: c.version,
        createdToday: businessDateIST(c.createdAt) === today,
      }))}
    />
  );
}
