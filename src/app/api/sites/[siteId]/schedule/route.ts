import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { getCurrentBaseline } from "@/lib/schedule/service";

// Full schedule picture for the Gantt: baseline + latest suggestion +
// forecasts + progress totals.
export const GET = withApi(async (_req, params) => {
  const siteId = params.siteId;
  await guard("dashboard.view", { siteId });

  const [baseline, suggestion, activities] = await Promise.all([
    getCurrentBaseline(siteId),
    prisma.scheduleSuggestion.findFirst({
      where: { siteId },
      orderBy: { generatedAt: "desc" },
      include: { dates: true },
    }),
    prisma.activity.findMany({ where: { siteId }, orderBy: { sequence: "asc" } }),
  ]);

  const forecasts = await prisma.activityForecast.findMany({
    where: { activityId: { in: activities.map((a) => a.id) } },
  });
  const progress = await prisma.progressEntry.groupBy({
    by: ["activityId"],
    where: { siteId, isCurrent: true, status: "submitted" },
    _sum: { qtyDone: true },
  });

  return NextResponse.json({ baseline, suggestion, activities, forecasts, progress });
});
