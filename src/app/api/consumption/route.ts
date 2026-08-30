import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { consumptionEntrySchema } from "@/lib/versioning/schemas";
import { runConsumptionAudit } from "@/lib/audit/engine";

export const POST = withApi(async (req: NextRequest) => {
  const data = consumptionEntrySchema.parse(await req.json());
  const ctx = await guard("consumption.create", { siteId: data.siteId });

  const [material, activity] = await Promise.all([
    prisma.material.findUnique({ where: { id: data.materialId } }),
    prisma.activity.findUnique({ where: { id: data.activityId } }),
  ]);
  if (!material) throw new ApiError(400, "Unknown material");
  if (!activity || activity.siteId !== data.siteId) {
    throw new ApiError(400, "Activity does not belong to this site");
  }
  if (activity.isGroup) {
    throw new ApiError(
      400,
      `"${activity.name}" is a main activity heading — book consumption against a specific work item under it`,
    );
  }
  if (data.mixDesignId) {
    const mix = await prisma.mixDesign.findUnique({ where: { id: data.mixDesignId } });
    if (!mix) throw new ApiError(400, "Unknown mix design");
  }

  const entry = await prisma.consumptionEntry.create({
    data: { ...data, status: "submitted", createdById: ctx.userId },
  });

  // Real-time consumption audit: theoretical (mix × progress) vs actual.
  const flag = await runConsumptionAudit({
    siteId: data.siteId,
    activityId: data.activityId,
    mixDesignId: data.mixDesignId ?? null,
  }).catch((err) => {
    console.error("consumption audit failed", err);
    return null;
  });

  return NextResponse.json({ entry, flag }, { status: 201 });
});

const listQuery = z.object({
  siteId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.ops.view", { siteId: q.siteId });
  const entries = await prisma.consumptionEntry.findMany({
    where: { siteId: q.siteId, activityId: q.activityId, isCurrent: true, status: "submitted" },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ entries });
});
