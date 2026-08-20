import { redirect } from "next/navigation";
import { pageCtx } from "@/lib/auth/page-guard";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { prisma } from "@/lib/db";
import { SignOutButton } from "@/components/SignOutButton";
import { EnablePushButton } from "@/components/EnablePushButton";
import { ApprovalQueue } from "./approval-queue";

export default async function ApprovalsPage() {
  const ctx = await pageCtx();
  const accountsSites = [...ctx.siteRoles.entries()]
    .filter(([, role]) => role === "accounts")
    .map(([siteId]) => siteId);
  if (!ctx.isOwner && accountsSites.length === 0) redirect("/no-access");

  const siteIds = ctx.isOwner ? undefined : accountsSites;
  const items = await listRequisitionsWithState({ siteIds, kind: "fund" });
  const sites = await prisma.site.findMany({
    where: siteIds ? { id: { in: siteIds } } : {},
    select: { id: true, name: true, code: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: items.map((i) => i.requisition.createdById) } },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-surface">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-600">
              Accounts
            </p>
            <h1 className="text-base font-semibold text-slate-900">Fund allocation requests</h1>
          </div>
          <div className="flex items-center gap-3">
            <EnablePushButton />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="px-3 py-4">
        <ApprovalQueue
          items={items.map(({ requisition, actions, state }) => ({
            entityId: requisition.entityId,
            siteName:
              sites.find((s) => s.id === requisition.siteId)?.name ?? "Site",
            raisedBy: users.find((u) => u.id === requisition.createdById)?.name ?? "Engineer",
            createdAt: requisition.createdAt.toISOString(),
            neededBy: requisition.neededBy?.toISOString().slice(0, 10) ?? null,
            amountTotal: Number(requisition.amountTotal ?? 0),
            justification: requisition.justification,
            lines: requisition.lines as { head: string; amount: number }[],
            version: requisition.version,
            state,
            actions: actions.map((a) => ({
              action: a.action,
              reason: a.reason,
              approvedAmount: a.approvedAmount !== null ? Number(a.approvedAmount) : null,
              createdAt: a.createdAt.toISOString(),
            })),
          }))}
        />
      </main>
    </div>
  );
}
