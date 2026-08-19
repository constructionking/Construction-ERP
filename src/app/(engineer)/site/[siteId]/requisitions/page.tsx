import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { RequisitionsScreen } from "./requisitions-screen";

export default async function RequisitionsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const [items, materials] = await Promise.all([
    listRequisitionsWithState({ siteIds: [siteId] }),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <RequisitionsScreen
      siteId={siteId}
      materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
      items={items.map(({ requisition, actions, state }) => ({
        entityId: requisition.entityId,
        kind: requisition.kind,
        lines: requisition.lines as never,
        amountTotal: requisition.amountTotal !== null ? Number(requisition.amountTotal) : null,
        justification: requisition.justification,
        neededBy: requisition.neededBy?.toISOString().slice(0, 10) ?? null,
        createdAt: requisition.createdAt.toISOString(),
        version: requisition.version,
        state,
        editable: actions.length === 0, // until first approver action
        latestReason: actions.length ? (actions[actions.length - 1].reason ?? null) : null,
      }))}
    />
  );
}
