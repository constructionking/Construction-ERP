import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { formatINR } from "@/lib/format/inr";
import { OwnerRequisitionCard } from "./owner-requisition-card";

export default async function OwnerApprovalsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const [items, materials, users] = await Promise.all([
    listRequisitionsWithState({ siteIds: [siteId] }),
    prisma.material.findMany(),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m.name]));
  const userById = new Map(users.map((u) => [u.id, u.name]));

  const materialPending = items.filter(
    (i) => i.requisition.kind === "material" && ["pending", "resubmitted"].includes(i.state)
  );
  const fundAll = items.filter((i) => i.requisition.kind === "fund");
  const decided = items.filter(
    (i) => i.requisition.kind === "material" && !["pending", "resubmitted"].includes(i.state)
  );

  return (
    <div className="space-y-4">
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
          <CardTitle>Fund requests (decided by Accounts — view only)</CardTitle>
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
                      state === "approved" || state === "partially_approved"
                        ? "green"
                        : state === "rejected"
                          ? "red"
                          : "blue"
                    }
                  >
                    {state.replace("_", " ")}
                  </Badge>
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
