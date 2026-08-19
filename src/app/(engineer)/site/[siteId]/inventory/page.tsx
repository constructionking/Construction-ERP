import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { computeSiteStock } from "@/lib/inventory/stock";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
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
      where: { siteId },
      orderBy: { sequence: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.mixDesign.findMany({ orderBy: { code: "asc" } }),
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

  return (
    <InventoryTabs
      siteId={siteId}
      today={today}
      stock={stock}
      materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
      activities={activities}
      mixDesigns={mixDesigns.map((m) => ({ id: m.id, code: m.code, name: m.name }))}
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
