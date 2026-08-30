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
  boqRate: z.number().positive().nullable().optional(),
});

export const PATCH = withApi(async (req: NextRequest, params) => {
  const activity = await prisma.activity.findUnique({ where: { id: params.id } });
  if (!activity) throw new ApiError(404, "Activity not found");
  await guard("activity.manage", { siteId: activity.siteId });
  const data = patchSchema.parse(await req.json());
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
  // Refuse deletion once progress exists against it — history must survive.
  const used = await prisma.progressEntry.findFirst({ where: { activityId: params.id } });
  if (used) {
    throw new ApiError(409, "Activity has progress records; it cannot be deleted");
  }
  await prisma.activityDependency.deleteMany({
    where: { OR: [{ predecessorId: params.id }, { successorId: params.id }] },
  });
  await prisma.activity.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
