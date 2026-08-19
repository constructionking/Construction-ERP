import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { labourEntrySchema } from "@/lib/versioning/schemas";
import { runLabourAudit } from "@/lib/audit/engine";

export const POST = withApi(async (req: NextRequest) => {
  const data = labourEntrySchema.parse(await req.json());
  const ctx = await guard("labour.create", { siteId: data.siteId });

  const workType = await prisma.workType.findUnique({ where: { id: data.workTypeId } });
  if (!workType) throw new ApiError(400, "Unknown work type");

  const entry = await prisma.labourEntry.create({
    data: { ...data, status: "submitted", createdById: ctx.userId },
  });

  const flag = await runLabourAudit(entry.entityId).catch((err) => {
    console.error("labour audit failed", err);
    return null;
  });

  return NextResponse.json({ entry, flag }, { status: 201 });
});

const listQuery = z.object({ siteId: z.string().uuid() });

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.ops.view", { siteId: q.siteId });
  const entries = await prisma.labourEntry.findMany({
    where: { siteId: q.siteId, isCurrent: true, status: "submitted" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const closures = await prisma.labourPeriodClosure.findMany({
    where: { labourEntityId: { in: entries.map((e) => e.entityId) } },
  });
  return NextResponse.json({ entries, closures });
});
