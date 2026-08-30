import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { categoryEnum, unitEnum } from "@/lib/versioning/schemas";

export const GET = withApi(async (_req, params) => {
  const siteId = params.siteId;
  await guard("site.ops.view", { siteId });
  const activities = await prisma.activity.findMany({
    where: { siteId },
    orderBy: { sequence: "asc" },
    include: { predecessors: true },
  });
  return NextResponse.json({ activities });
});

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9._-]+$/i),
  name: z.string().trim().min(2).max(200),
  parentId: z.string().uuid().optional(),
  category: categoryEnum.default("general"),
  boqQty: z.number().positive().optional(),
  unit: unitEnum.optional(),
  productivityNormQtyPerDay: z.number().positive().optional(),
  sequence: z.number().int().nonnegative().default(0),
  contractorName: z.string().trim().max(120).optional(),
  boqRate: z.number().positive().optional(),
  dependsOn: z
    .array(z.object({ predecessorId: z.string().uuid(), lagDays: z.number().int().default(0) }))
    .default([]),
});

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const { dependsOn, ...data } = createSchema
    .extend({ isGroup: z.boolean().default(false) })
    .parse(await req.json());

  // Two-level WBS rules: a group (main activity) carries no qty/unit/norm/
  // contractor and no dependencies; a leaf may sit under exactly one group.
  const { ApiError } = await import("@/lib/auth/guard");
  if (data.isGroup) {
    if (data.boqQty !== undefined || data.unit !== undefined || data.productivityNormQtyPerDay !== undefined)
      throw new ApiError(400, "A main activity is only a heading — it carries no quantity/unit/norm");
    if (data.parentId) throw new ApiError(400, "Main activities cannot be nested");
    if (dependsOn.length > 0) throw new ApiError(400, "Main activities cannot have dependencies");
  }
  if (data.parentId) {
    const parent = await prisma.activity.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.siteId !== siteId || !parent.isGroup) {
      throw new ApiError(400, "Parent must be a main activity of this site");
    }
  }

  const activity = await prisma.$transaction(async (tx) => {
    const created = await tx.activity.create({
      data: { ...data, code: data.code.toUpperCase(), siteId },
    });
    for (const dep of dependsOn) {
      await tx.activityDependency.create({
        data: { predecessorId: dep.predecessorId, successorId: created.id, lagDays: dep.lagDays },
      });
    }
    return created;
  });

  return NextResponse.json({ activity }, { status: 201 });
});
