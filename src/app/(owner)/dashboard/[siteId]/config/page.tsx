import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { getAmendmentPolicies } from "@/lib/versioning/amend";
import { ConfigScreen } from "./config-screen";

export default async function ConfigPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [site, activities, users, roles, materials, mixes, workTypes, policies] = await Promise.all([
    prisma.site.findUnique({
      where: { id: siteId },
      select: { name: true, code: true, location: true, status: true, startDate: true },
    }),
    prisma.activity.findMany({
      where: { siteId },
      orderBy: { sequence: "asc" },
      include: { predecessors: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, isOwner: true },
      orderBy: { name: "asc" },
    }),
    prisma.siteRole.findMany({ where: { siteId } }),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.mixDesign.findMany({ include: { coefficients: true }, orderBy: { code: "asc" } }),
    prisma.workType.findMany({ orderBy: { name: "asc" } }),
    getAmendmentPolicies(),
  ]);
  const contractors = await prisma.contractor.findMany({
    where: { siteId },
    include: { rates: { orderBy: { createdAt: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <ConfigScreen
      siteId={siteId}
      site={{
        name: site?.name ?? "",
        code: site?.code ?? "",
        location: site?.location ?? "",
        status: site?.status ?? "active",
        startDate: site?.startDate ? site.startDate.toISOString().slice(0, 10) : "",
      }}
      activities={activities.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        isGroup: a.isGroup,
        parentId: a.parentId,
        contractorId: a.contractorId,
        startDate: a.startDate ? a.startDate.toISOString().slice(0, 10) : "",
        category: a.category,
        boqQty: a.boqQty?.toString() ?? "",
        boqRate: a.boqRate?.toString() ?? "",
        unit: a.unit ?? "",
        norm: a.productivityNormQtyPerDay?.toString() ?? "",
        sequence: a.sequence,
        contractorName: a.contractorName ?? "",
        dependsOn: a.predecessors.map((d) => d.predecessorId),
      }))}
      users={users}
      roles={roles.map((r) => ({ userId: r.userId, role: r.role }))}
      materials={materials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        category: m.category,
        densityKgPerCum: m.densityKgPerCum?.toString() ?? "",
        unitsPerCum: m.unitsPerCum?.toString() ?? "",
      }))}
      mixes={mixes.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        outputUnit: m.outputUnit,
        status: m.status,
        note: m.note ?? "",
        coefficients: m.coefficients.map((c) => ({
          materialId: c.materialId,
          qtyPerUnit: c.qtyPerUnit.toString(),
        })),
      }))}
      workTypes={workTypes.map((w) => ({ id: w.id, name: w.name, defaultUnit: w.defaultUnit }))}
      contractors={contractors.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? "",
        active: c.active,
        rates: c.rates.map((r) => ({
          id: r.id,
          activityId: r.activityId,
          description: r.description ?? "",
          unit: r.unit ?? "",
          rate: r.rate.toString(),
          note: r.note ?? "",
        })),
      }))}
      policies={policies.map((p) => ({
        recordType: p.recordType,
        allowedWindow: p.allowedWindow,
        allowedActor: p.allowedActor,
        enabled: p.enabled,
      }))}
    />
  );
}
