import { prisma } from "@/lib/db";
import type { ApprovalAction, Requisition } from "@prisma/client";

export type RequisitionState =
  | "pending"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "queried"
  | "queued"
  | "resubmitted";

/**
 * A requisition's state is DERIVED from the append-only action log:
 * no action → pending; latest action wins; a new version submitted after the
 * latest action (answering a query) shows as resubmitted for the approver.
 */
export function deriveState(
  current: Pick<Requisition, "createdAt">,
  actions: Pick<ApprovalAction, "action" | "createdAt">[]
): RequisitionState {
  if (actions.length === 0) return "pending";
  const latest = actions.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  if (current.createdAt > latest.createdAt) return "resubmitted";
  return latest.action;
}

export async function listRequisitionsWithState(where: {
  siteIds?: string[];
  kind?: "material" | "fund";
  raisedById?: string;
}) {
  const requisitions = await prisma.requisition.findMany({
    where: {
      isCurrent: true,
      status: "submitted",
      siteId: where.siteIds ? { in: where.siteIds } : undefined,
      kind: where.kind,
      createdById: where.raisedById,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  if (requisitions.length === 0) return [];

  const actions = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: { in: requisitions.map((r) => r.entityId) } },
    orderBy: { createdAt: "asc" },
  });
  const actionsByEntity = new Map<string, ApprovalAction[]>();
  for (const action of actions) {
    const list = actionsByEntity.get(action.requisitionEntityId) ?? [];
    list.push(action);
    actionsByEntity.set(action.requisitionEntityId, list);
  }

  return requisitions.map((requisition) => ({
    requisition,
    actions: actionsByEntity.get(requisition.entityId) ?? [],
    state: deriveState(requisition, actionsByEntity.get(requisition.entityId) ?? []),
  }));
}
