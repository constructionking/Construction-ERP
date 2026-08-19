import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { dateOnly } from "@/lib/versioning/day-close";
import { runLabourAudit } from "@/lib/audit/engine";

const closeSchema = z.object({
  closedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => new Date(s)),
  finalOutputQty: z.number().positive().max(10_000_000),
});

// Closing an open labour period is a designed lifecycle event, NOT an
// amendment — no reason ritual. It is one-shot and immutable once written.
export const POST = withApi(async (req: NextRequest, params) => {
  const entityId = z.string().uuid().parse(params.entityId);
  const body = closeSchema.parse(await req.json());

  const entry = await prisma.labourEntry.findFirst({
    where: { entityId, isCurrent: true, status: "submitted" },
  });
  if (!entry) throw new ApiError(404, "Labour entry not found");
  if (entry.entryType !== "period") {
    throw new ApiError(400, "Only period-based labour can be closed");
  }

  const ctx = await guard("labour.closePeriod", { siteId: entry.siteId });

  if (entry.periodStart && dateOnly(body.closedOn) < dateOnly(entry.periodStart)) {
    throw new ApiError(400, "Close date cannot be before the period start");
  }

  const existing = await prisma.labourPeriodClosure.findUnique({
    where: { labourEntityId: entityId },
  });
  if (existing) throw new ApiError(409, "This period is already closed");

  const closure = await prisma.labourPeriodClosure.create({
    data: {
      labourEntityId: entityId,
      closedOn: body.closedOn,
      finalOutputQty: body.finalOutputQty,
      closedById: ctx.userId,
    },
  });

  const flag = await runLabourAudit(entityId).catch((err) => {
    console.error("labour audit failed", err);
    return null;
  });

  return NextResponse.json({ closure, flag }, { status: 201 });
});
