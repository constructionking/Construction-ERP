import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, Badge, EmptyState } from "@/components/ui";
import { NewSiteForm } from "./new-site-form";

export default async function DashboardIndex() {
  const sites = await prisma.site.findMany({ orderBy: { name: "asc" } });

  const [flagCounts, progressBySite] = await Promise.all([
    prisma.auditFlag.groupBy({
      by: ["siteId", "severity"],
      where: { status: "open" },
      _count: true,
    }),
    prisma.activity.groupBy({ by: ["siteId"], _count: true, where: { isGroup: false } }),
  ]);

  const openBySite = new Map<string, { warn: number; critical: number }>();
  for (const row of flagCounts) {
    const entry = openBySite.get(row.siteId) ?? { warn: 0, critical: 0 };
    if (row.severity === "critical") entry.critical += row._count;
    else entry.warn += row._count;
    openBySite.set(row.siteId, entry);
  }
  const activityCount = new Map(progressBySite.map((p) => [p.siteId, p._count]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Your sites</h1>
      </div>

      {sites.length === 0 ? (
        <EmptyState title="No sites yet" hint="Create your first site below" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => {
            const flags = openBySite.get(site.id);
            return (
              <Link key={site.id} href={`/dashboard/${site.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{site.name}</p>
                        <p className="text-xs text-slate-500">
                          {site.code}
                          {site.location ? ` · ${site.location}` : ""}
                        </p>
                      </div>
                      <Badge
                        tone={
                          site.status === "active"
                            ? "green"
                            : site.status === "on_hold"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {site.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <span>{activityCount.get(site.id) ?? 0} activities</span>
                      {flags?.critical ? (
                        <Badge tone="red">{flags.critical} critical</Badge>
                      ) : null}
                      {flags?.warn ? <Badge tone="amber">{flags.warn} flags</Badge> : null}
                      {!flags ? <Badge tone="green">no open flags</Badge> : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <NewSiteForm />
    </div>
  );
}
