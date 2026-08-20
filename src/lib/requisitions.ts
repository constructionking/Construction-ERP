import { prisma } from "@/lib/db";
import type { ApprovalAction, Requisition, RequisitionKind } from "@prisma/client";

// ---------------------------------------------------------------------------
// Requisition lifecycle — DERIVED from the append-only action log.
//
// MATERIAL requests (Phase 1): engineer → owner decides. Terminal on
// approved/rejected.
//
// FUND requests — the three-step money chain:
//   engineer raises → ACCOUNTS approves/partial (recommendation)
//     → awaiting_owner  (owner gets a push; final approval on the dashboard)
//   → OWNER owner_approved → awaiting_release (accounts gets a push)
//   → ACCOUNTS released   (money actually goes out — terminal)
// Reject at either level is terminal; a query hands it back to the engineer.
// ---------------------------------------------------------------------------

export type RequisitionState =
  | "pending"
  | "resubmitted"
  | "queried"
  | "queued"
  | "rejected"
  | "approved" // terminal for material
  | "partially_approved"
  | "awaiting_owner"
  | "awaiting_release"
  | "owner_rejected"
  | "released";

export function deriveState(
  kind: RequisitionKind,
  current: Pick<Requisition, "createdAt">,
  actions: Pick<ApprovalAction, "action" | "createdAt">[]
): RequisitionState {
  if (actions.length === 0) return "pending";
  const latest = actions.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));

  // A version submitted after the latest action = the engineer answered a
  // query; it goes back to the front of the accounts queue.
  if (current.createdAt > latest.createdAt) return "resubmitted";

  if (kind === "material") {
    return latest.action as RequisitionState;
  }

  switch (latest.action) {
    case "approved":
    case "partially_approved":
      return "awaiting_owner";
    case "owner_approved":
      return "awaiting_release";
    case "owner_rejected":
      return "owner_rejected";
    case "released":
      return "released";
    default:
      return latest.action as RequisitionState;
  }
}

/** Actions the ACCOUNTS role may take on a fund request, per current state. */
export const ACCOUNTS_FUND_ACTIONS: Record<RequisitionState, string[]> = {
  pending: ["approved", "partially_approved", "rejected", "queried", "queued"],
  resubmitted: ["approved", "partially_approved", "rejected", "queried", "queued"],
  queued: ["approved", "partially_approved", "rejected", "queried"],
  queried: ["rejected"], // waiting on the engineer; accounts may still close it
  awaiting_owner: [], // it is with the owner now
  awaiting_release: ["released"],
  approved: [],
  partially_approved: [],
  rejected: [],
  owner_rejected: [],
  released: [],
};

/** Actions the OWNER may take on a fund request, per current state. */
export const OWNER_FUND_ACTIONS: Record<RequisitionState, string[]> = {
  awaiting_owner: ["owner_approved", "owner_rejected"],
  pending: [],
  resubmitted: [],
  queued: [],
  queried: [],
  awaiting_release: [],
  approved: [],
  partially_approved: [],
  rejected: [],
  owner_rejected: [],
  released: [],
};

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
    state: deriveState(
      requisition.kind,
      requisition,
      actionsByEntity.get(requisition.entityId) ?? []
    ),
  }));
}
