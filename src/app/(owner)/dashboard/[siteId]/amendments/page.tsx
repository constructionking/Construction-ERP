import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { RECORD_DELEGATE } from "@/lib/versioning/amend";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import type { RecordType } from "@prisma/client";

const TYPE_LABELS: Record<string, string> = {
  progress_entry: "Progress entry",
  measurement_book: "Measurement book",
  material_receipt: "Material receipt",
  consumption_entry: "Consumption",
  requisition: "Requisition",
  labour_entry: "Labour entry",
};

export default async function AmendmentsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, []);

  const logs = await prisma.editLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // Filter to this site: resolve each entity's site via its record type.
  const siteLogs: typeof logs = [];
  const cache = new Map<string, string | null>();
  for (const log of logs) {
    const cacheKey = `${log.entityType}:${log.entityId}`;
    let logSiteId = cache.get(cacheKey);
    if (logSiteId === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (prisma[RECORD_DELEGATE[log.entityType as RecordType]] as any).findFirst({
        where: { entityId: log.entityId },
        select: { siteId: true },
      });
      logSiteId = (row?.siteId as string | undefined) ?? null;
      cache.set(cacheKey, logSiteId);
    }
    if (logSiteId === siteId) siteLogs.push(log);
    if (siteLogs.length >= 60) break;
  }

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const userById = new Map(users.map((u) => [u.id, u.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Amendment log — every change after submission, with its reason</CardTitle>
      </CardHeader>
      <CardContent>
        {siteLogs.length === 0 ? (
          <EmptyState
            title="No amendments"
            hint="Submitted records have not been changed — originals stand as entered"
          />
        ) : (
          <div className="space-y-2">
            {siteLogs.map((log) => {
              const diff = log.diff as Record<string, { from: unknown; to: unknown }>;
              return (
                <div key={log.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={log.actorRole === "owner" ? "blue" : "amber"}>
                          {log.actorRole}
                        </Badge>
                        <span className="text-sm font-medium text-slate-800">
                          {TYPE_LABELS[log.entityType] ?? log.entityType}
                        </span>
                        <span className="text-xs text-slate-400">
                          v{log.fromVersion} → v{log.toVersion} · {userById.get(log.actorId) ?? "?"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium">Reason:</span> {log.reason}
                      </p>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(diff).map(([field, change]) => (
                          <p key={field} className="text-xs text-slate-500">
                            <span className="font-medium">{field}</span>:{" "}
                            <span className="text-red-600 line-through">
                              {String(change.from ?? "—")}
                            </span>{" "}
                            → <span className="text-emerald-700">{String(change.to ?? "—")}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {log.createdAt.toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
