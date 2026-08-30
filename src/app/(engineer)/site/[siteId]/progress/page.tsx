import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { businessDateIST, dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui";
import { formatQty } from "@/lib/format/units";
import { ProgressForm } from "./progress-form";
import { AmendButton } from "@/components/AmendButton";

export default async function ProgressPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const today = businessDateIST();
  const [activities, entries] = await Promise.all([
    prisma.activity.findMany({
      // Leaves only: main-activity headings are never progress targets.
      where: { siteId, isGroup: false },
      orderBy: { sequence: "asc" },
      select: { id: true, code: true, name: true, unit: true, parent: { select: { name: true } } },
    }),
    prisma.progressEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted" },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 30,
    }),
  ]);
  const activityById = new Map(activities.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Daily progress
        </h2>
        <Link
          href={`/site/${siteId}/measurement-book`}
          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          Measurement book →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New entry — {today}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProgressForm
            siteId={siteId}
            today={today}
            activities={activities.map((a) => ({
              id: a.id,
              code: a.code,
              name: a.name,
              unit: a.unit,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <EmptyState title="No progress recorded yet" hint="Submit today's first entry above" />
          ) : (
            entries.map((entry) => {
              const activity = activityById.get(entry.activityId);
              const entryDay = dateOnly(entry.entryDate);
              const createdToday = businessDateIST(entry.createdAt) === today;
              return (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {activity ? `${activity.code} · ${activity.name}` : "Activity"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entryDay} · {formatQty(entry.qtyDone.toString(), entry.unit)} ·{" "}
                      {entry.executedBy === "dept" ? "Departmental" : entry.contractorName}
                    </p>
                    {entry.version > 1 ? (
                      <Badge tone="amber" className="mt-1">
                        Amended v{entry.version}
                      </Badge>
                    ) : null}
                  </div>
                  {createdToday ? (
                    <AmendButton
                      recordType="progress_entry"
                      entityId={entry.entityId}
                      fields={[
                        { name: "qtyDone", label: `Qty (${entry.unit})`, type: "number", value: entry.qtyDone.toString() },
                        { name: "notes", label: "Notes", type: "text", value: entry.notes ?? "" },
                      ]}
                      carry={{
                        activityId: entry.activityId,
                        entryDate: entryDay,
                        unit: entry.unit,
                        executedBy: entry.executedBy,
                        contractorName: entry.contractorName ?? undefined,
                      }}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
