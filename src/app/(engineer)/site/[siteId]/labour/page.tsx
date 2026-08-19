import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { LabourScreen } from "./labour-screen";

export default async function LabourPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const [workTypes, entries] = await Promise.all([
    prisma.workType.findMany({ orderBy: { name: "asc" } }),
    prisma.labourEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const closures = await prisma.labourPeriodClosure.findMany({
    where: { labourEntityId: { in: entries.map((e) => e.entityId) } },
  });
  const closedSet = new Set(closures.map((c) => c.labourEntityId));
  const today = businessDateIST();

  return (
    <LabourScreen
      siteId={siteId}
      today={today}
      workTypes={workTypes.map((w) => ({ id: w.id, name: w.name, defaultUnit: w.defaultUnit }))}
      entries={entries.map((entry) => ({
        entityId: entry.entityId,
        entryType: entry.entryType,
        source: entry.source,
        contractorName: entry.contractorName,
        workTypeId: entry.workTypeId,
        workersCount: entry.workersCount,
        rate: entry.rate.toString(),
        rateBasis: entry.rateBasis,
        outputQty: entry.outputQty?.toString() ?? null,
        outputUnit: entry.outputUnit,
        entryDate: entry.entryDate ? dateOnly(entry.entryDate) : null,
        periodStart: entry.periodStart ? dateOnly(entry.periodStart) : null,
        periodEnd: entry.periodEnd ? dateOnly(entry.periodEnd) : null,
        version: entry.version,
        createdToday: businessDateIST(entry.createdAt) === today,
        closed: closedSet.has(entry.entityId),
      }))}
    />
  );
}
