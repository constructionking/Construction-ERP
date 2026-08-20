import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { releaseLog } from "@/lib/reports/releases";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { formatINR, formatINRCompact } from "@/lib/format/inr";
import { OwnerRequisitionCard } from "./owner-requisition-card";

function stamp(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default async function OwnerApprovalsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [items, materials, users, releases] = await Promise.all([
    listRequisitionsWithState({ siteIds: [siteId] }),
    prisma.material.findMany(),
    prisma.user.findMany({ select: { id: true, name: true } }),
    releaseLog(siteId),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m.name]));
  const userById = new Map(users.map((u) => [u.id, u.name]));

  const materialPending = items.filter(
    (i) => i.requisition.kind === "material" && ["pending", "resubmitted"].includes(i.state)
  );
  const fundAwaitingOwner = items.filter(
    (i) => i.requisition.kind === "fund" && i.state === "awaiting_owner"
  );
  const fundAll = items.filter(
    (i) => i.requisition.kind === "fund" && i.state !== "awaiting_owner"
  );
  const decided = items.filter(
    (i) => i.requisition.kind === "material" && !["pending", "resubmitted"].includes(i.state)
  );

  return (
    <div className="space-y-4">
      {fundAwaitingOwner.length > 0 ? (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>
              💰 Fund requests awaiting YOUR final approval ({fundAwaitingOwner.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Accounts has verified these. Your approval sends them back to accounts for the
              actual release of funds.
            </p>
            {fundAwaitingOwner.map(({ requisition, state }) => (
              <OwnerRequisitionCard
                key={requisition.entityId}
                mode="fundFinal"
                entityId={requisition.entityId}
                state={state}
                raisedBy={userById.get(requisition.createdById) ?? "Engineer"}
                createdAt={requisition.createdAt.toISOString()}
                justification={requisition.justification}
                lines={[
                  ...(requisition.lines as { head: string; amount: number }[]).map((line) => ({
                    label: line.head,
                    value: formatINR(line.amount),
                  })),
                  {
                    label: "Accounts cleared",
                    value: formatINR(Number(requisition.amountTotal ?? 0)),
                  },
                ]}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Material requests awaiting your decision ({materialPending.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {materialPending.length === 0 ? (
            <EmptyState title="Nothing pending" />
          ) : (
            materialPending.map(({ requisition, state }) => (
              <OwnerRequisitionCard
                key={requisition.entityId}
                entityId={requisition.entityId}
                state={state}
                raisedBy={userById.get(requisition.createdById) ?? "Engineer"}
                createdAt={requisition.createdAt.toISOString()}
                justification={requisition.justification}
                lines={(requisition.lines as { materialId: string; qty: number; unit: string }[]).map(
                  (line) => ({
                    label: materialById.get(line.materialId) ?? "Material",
                    value: `${line.qty.toLocaleString("en-IN")} ${line.unit}`,
                  })
                )}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fund request pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {fundAll.length === 0 ? (
            <EmptyState title="No fund requests" />
          ) : (
            <div className="space-y-2">
              {fundAll.map(({ requisition, state, actions }) => (
                <div
                  key={requisition.entityId}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {formatINR(Number(requisition.amountTotal ?? 0))}
                    </span>{" "}
                    <span className="text-slate-500">
                      by {userById.get(requisition.createdById) ?? "?"} ·{" "}
                      {requisition.createdAt.toLocaleDateString("en-IN")}
                    </span>
                    {actions.length > 0 && actions[actions.length - 1].reason ? (
                      <p className="text-xs text-slate-400">
                        {actions[actions.length - 1].reason}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    tone={
                      state === "released"
                        ? "green"
                        : state === "awaiting_release"
                          ? "amber"
                          : state === "rejected" || state === "owner_rejected"
                            ? "red"
                            : "blue"
                    }
                  >
                    {state === "awaiting_release"
                      ? "release pending"
                      : state.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>💸 Funds release log — every rupee released, dated & timed</CardTitle>
            {releases.rows.length > 0 ? (
              <Badge tone="blue">total {formatINRCompact(releases.totalReleased)}</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {releases.rows.length === 0 ? (
            <EmptyState
              title="No releases yet"
              hint="Every release lands here permanently: when, how much, for what, and who signed off"
            />
          ) : (
            <div className="space-y-2">
              {releases.rows.map((row) => (
                <div
                  key={`${row.requisitionEntityId}-${row.releasedAt.getTime()}`}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatINR(row.amount)}
                        <span className="ml-2 font-normal text-slate-500">
                          released {stamp(row.releasedAt)} by {row.releasedBy}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">{row.heads.join(" · ")}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {row.justification} — raised by {row.raisedBy}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        accounts ✓ {row.accountsApprovedBy} {stamp(row.accountsApprovedAt)} · owner
                        ✓ {row.ownerApprovedBy} {stamp(row.ownerApprovedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {decided.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recently decided material requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {decided.slice(0, 10).map(({ requisition, state }) => (
              <div
                key={requisition.entityId}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-600">
                  {userById.get(requisition.createdById) ?? "?"} ·{" "}
                  {requisition.createdAt.toLocaleDateString("en-IN")}
                </span>
                <Badge tone={state === "approved" ? "green" : state === "rejected" ? "red" : "neutral"}>
                  {state.replace("_", " ")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
