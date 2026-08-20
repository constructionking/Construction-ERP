import { prisma } from "@/lib/db";

// Dated + timed log of every fund release: derived entirely from the
// immutable approval_actions chain (nothing here can be edited after the fact).

export interface ReleaseLogRow {
  requisitionEntityId: string;
  releasedAt: Date;
  amount: number;
  heads: string[];
  justification: string;
  raisedBy: string;
  accountsApprovedBy: string;
  accountsApprovedAt: Date | null;
  ownerApprovedBy: string;
  ownerApprovedAt: Date | null;
  releasedBy: string;
}

export async function releaseLog(siteId: string): Promise<{
  rows: ReleaseLogRow[];
  totalReleased: number;
}> {
  const requisitions = await prisma.requisition.findMany({
    where: { siteId, kind: "fund", isCurrent: true, status: "submitted" },
  });
  if (requisitions.length === 0) return { rows: [], totalReleased: 0 };
  const byEntity = new Map(requisitions.map((r) => [r.entityId, r]));

  const actions = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: { in: requisitions.map((r) => r.entityId) } },
    orderBy: { createdAt: "asc" },
  });

  const userIds = new Set<string>();
  for (const action of actions) userIds.add(action.actorId);
  for (const requisition of requisitions) userIds.add(requisition.createdById);
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, name: true },
  });
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  const rows: ReleaseLogRow[] = [];
  for (const release of actions.filter((a) => a.action === "released")) {
    const requisition = byEntity.get(release.requisitionEntityId);
    if (!requisition) continue;
    const chain = actions.filter(
      (a) => a.requisitionEntityId === release.requisitionEntityId && a.createdAt <= release.createdAt
    );
    // Latest approvals in the chain that led to this release.
    const accountsApproval = [...chain].reverse().find((a) => a.action === "approved");
    const ownerApproval = [...chain].reverse().find((a) => a.action === "owner_approved");

    rows.push({
      requisitionEntityId: release.requisitionEntityId,
      releasedAt: release.createdAt,
      amount: Number(requisition.amountTotal ?? 0),
      heads: (requisition.lines as { head: string; amount: number }[]).map(
        (line) => `${line.head} (₹${line.amount.toLocaleString("en-IN")})`
      ),
      justification: requisition.justification,
      raisedBy: nameOf(requisition.createdById),
      accountsApprovedBy: accountsApproval ? nameOf(accountsApproval.actorId) : "—",
      accountsApprovedAt: accountsApproval?.createdAt ?? null,
      ownerApprovedBy: ownerApproval ? nameOf(ownerApproval.actorId) : "—",
      ownerApprovedAt: ownerApproval?.createdAt ?? null,
      releasedBy: nameOf(release.actorId),
    });
  }

  rows.sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
  return {
    rows,
    totalReleased: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}
