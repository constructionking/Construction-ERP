import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

// Owner-only bulk reset of a site's work-item list, for the "my first import
// was a test — start over" case. REFUSES the moment any operational record
// references an activity: history is never deleted (app invariant).
// Note: locked baselines keep their (now orphan) activityIds — BaselineActivity
// has no FK by design and every consumer is null-safe; a fresh baseline is
// locked after re-import anyway.

export const POST = withApi(async (_req, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });

  const activityIds = (
    await prisma.activity.findMany({ where: { siteId }, select: { id: true } })
  ).map((a) => a.id);
  if (activityIds.length === 0) return NextResponse.json({ deleted: 0 });

  const [progress, consumption, mbLines, photos] = await Promise.all([
    prisma.progressEntry.count({ where: { activityId: { in: activityIds } } }),
    prisma.consumptionEntry.count({ where: { activityId: { in: activityIds } } }),
    prisma.mbLine.count({ where: { measurementBook: { siteId } } }),
    prisma.photo.count({ where: { activityId: { in: activityIds } } }),
  ]);
  const refs = progress + consumption + mbLines + photos;
  if (refs > 0) {
    throw new ApiError(
      409,
      `Cannot delete the work-item list: ${refs} records (progress/consumption/MB/photos) reference it. History is never deleted.`,
    );
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.activityDependency.deleteMany({
      where: { OR: [{ predecessorId: { in: activityIds } }, { successorId: { in: activityIds } }] },
    });
    await tx.activityForecast.deleteMany({ where: { activityId: { in: activityIds } } });
    await tx.suggestedDate.deleteMany({ where: { activityId: { in: activityIds } } });
    // Children first (FK on parentId), then groups.
    await tx.activity.deleteMany({ where: { siteId, isGroup: false } });
    await tx.activity.deleteMany({ where: { siteId, isGroup: true } });
    return activityIds.length;
  });

  return NextResponse.json({ deleted });
});
