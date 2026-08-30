import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { categoryEnum, unitEnum } from "@/lib/versioning/schemas";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  category: categoryEnum.optional(),
  boqQty: z.number().positive().nullable().optional(),
  unit: unitEnum.optional(),
  productivityNormQtyPerDay: z.number().positive().nullable().optional(),
  sequence: z.number().int().nonnegative().optional(),
  contractorName: z.string().trim().max(120).nullable().optional(),
  boqRate: z.number().positive().max(100_000_000).nullable().optional(),
  // Move the item under a different main activity (null = ungrouped).
  parentId: z.string().uuid().nullable().optional(),
});

export const PATCH = withApi(async (req: NextRequest, params) => {
  const activity = await prisma.activity.findUnique({ where: { id: params.id } });
  if (!activity) throw new ApiError(404, "Activity not found");
  await guard("activity.manage", { siteId: activity.siteId });
  const data = patchSchema.parse(await req.json());

  // Two-level WBS rules: main activities stay pure headings.
  if (activity.isGroup) {
    if (
      data.boqQty != null || data.unit !== undefined || data.boqRate != null ||
      data.productivityNormQtyPerDay != null || data.contractorName != null ||
      data.parentId != null
    ) {
      throw new ApiError(400, "A main activity is only a heading — it carries no qty/unit/rate");
    }
  }
  if (data.parentId) {
    const parent = await prisma.activity.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.siteId !== activity.siteId || !parent.isGroup || parent.id === activity.id) {
      throw new ApiError(400, "Parent must be a main activity of this site");
    }
  }

  const updated = await prisma.activity.update({ where: { id: params.id }, data });
  return NextResponse.json({ activity: updated });
});

export const DELETE = withApi(async (_req, params) => {
  const activity = await prisma.activity.findUnique({ where: { id: params.id } });
  if (!activity) throw new ApiError(404, "Activity not found");
  await guard("activity.manage", { siteId: activity.siteId });

  // A main activity with items must be emptied first (clean 409, not an FK error).
  const kids = await prisma.activity.count({ where: { parentId: params.id } });
  if (kids > 0) {
    throw new ApiError(409, `This main activity still has ${kids} work items — delete or move them first`);
  }
  // Refuse deletion once ANY operational record references it — history must
  // survive (same gate as the bulk reset). MB lines point at the code, not id.
  const [progress, consumption, photos, mbLines] = await Promise.all([
    prisma.progressEntry.count({ where: { activityId: params.id } }),
    prisma.consumptionEntry.count({ where: { activityId: params.id } }),
    prisma.photo.count({ where: { activityId: params.id } }),
    prisma.mbLine.count({
      where: { activityCode: activity.code, measurementBook: { siteId: activity.siteId } },
    }),
  ]);
  if (progress + consumption + photos + mbLines > 0) {
    throw new ApiError(
      409,
      "This item has recorded progress/consumption/MB/photo history; it cannot be deleted"
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.activityDependency.deleteMany({
      where: { OR: [{ predecessorId: params.id }, { successorId: params.id }] },
    });
    await tx.activityForecast.deleteMany({ where: { activityId: params.id } });
    await tx.suggestedDate.deleteMany({ where: { activityId: params.id } });
    await tx.activity.delete({ where: { id: params.id } });
  });
  return NextResponse.json({ ok: true });
});
