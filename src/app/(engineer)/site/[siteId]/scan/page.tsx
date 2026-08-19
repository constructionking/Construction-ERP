import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { ScanScreen } from "./scan-screen";

export default async function ScanPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const materials = await prisma.material.findMany({
    where: {
      active: true,
      // Only volume-convertible materials can be scanned.
      OR: [{ unit: "CUM" }, { densityKgPerCum: { not: null } }, { unitsPerCum: { not: null } }],
    },
    orderBy: { name: "asc" },
  });

  return (
    <ScanScreen
      siteId={siteId}
      materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
    />
  );
}
