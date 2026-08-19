import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { progressEntrySchema } from "@/lib/versioning/schemas";

export const POST = withApi(async (req: NextRequest) => {
  const body = await req.json();
  const data = progressEntrySchema.parse(body);
  const ctx = await guard("progress.create", { siteId: data.siteId });

  const activity = await prisma.activity.findUnique({ where: { id: data.activityId } });
  if (!activity || activity.siteId !== data.siteId) {
    throw new ApiError(400, "Activity does not belong to this site");
  }
  if (activity.unit && activity.unit !== data.unit) {
    throw new ApiError(400, `This activity is measured in ${activity.unit}`);
  }

  const entry = await prisma.progressEntry.create({
    data: { ...data, status: "submitted", createdById: ctx.userId },
  });

  // Keep forecasts + contractor-delay flags current with every new figure.
  const { recomputeForecasts } = await import("@/lib/schedule/service");
  await recomputeForecasts(data.siteId).catch((err) =>
    console.error("forecast recompute failed", err)
  );

  return NextResponse.json({ entry }, { status: 201 });
});

const listQuery = z.object({
  siteId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  activityId: z.string().uuid().optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const url = new URL(req.url);
  const q = listQuery.parse(Object.fromEntries(url.searchParams));
  await guard("site.view", { siteId: q.siteId });

  const entries = await prisma.progressEntry.findMany({
    where: {
      siteId: q.siteId,
      isCurrent: true,
      status: "submitted",
      activityId: q.activityId,
      entryDate: {
        gte: q.from ? new Date(q.from) : undefined,
        lte: q.to ? new Date(q.to) : undefined,
      },
    },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ entries });
});
