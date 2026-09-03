import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { unitEnum } from "@/lib/versioning/schemas";

const rateNum = z.number().positive().max(100_000_000);

const putSchema = z.object({
  // Rates agreed for work items (sub-activities of an assigned main
  // activity). rate null removes the row (rate no longer agreed).
  itemRates: z
    .array(z.object({ activityId: z.string().uuid(), rate: rateNum.nullable() }))
    .max(500)
    .optional(),
  // FULL list of free-form rates locked for future works (not in the BOQ):
  // rows with id update, without id create, ids missing from the list delete.
  futureRates: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        description: z.string().trim().min(2).max(200),
        unit: unitEnum,
        rate: rateNum,
        note: z.string().trim().max(200).nullable().optional(),
      })
    )
    .max(500)
    .optional(),
});

export const PUT = withApi(async (req: NextRequest, params) => {
  const contractor = await prisma.contractor.findUnique({ where: { id: params.id } });
  if (!contractor) throw new ApiError(404, "Contractor not found");
  await guard("activity.manage", { siteId: contractor.siteId });
  const data = putSchema.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    if (data.itemRates) {
      const ids = data.itemRates.map((r) => r.activityId);
      const activities = await tx.activity.findMany({
        where: { id: { in: ids } },
        select: { id: true, siteId: true, isGroup: true },
      });
      const byId = new Map(activities.map((a) => [a.id, a]));
      for (const r of data.itemRates) {
        const activity = byId.get(r.activityId);
        if (!activity || activity.siteId !== contractor.siteId || activity.isGroup) {
          throw new ApiError(400, "Rates attach to work items of this site, not main-activity headings");
        }
        if (r.rate === null) {
          await tx.contractorRate.deleteMany({
            where: { contractorId: params.id, activityId: r.activityId },
          });
        } else {
          await tx.contractorRate.upsert({
            where: {
              contractorId_activityId: { contractorId: params.id, activityId: r.activityId },
            },
            create: { contractorId: params.id, activityId: r.activityId, rate: r.rate },
            update: { rate: r.rate },
          });
        }
      }
    }

    if (data.futureRates) {
      const keepIds = data.futureRates.map((r) => r.id).filter((x): x is string => !!x);
      await tx.contractorRate.deleteMany({
        where: { contractorId: params.id, activityId: null, id: { notIn: keepIds } },
      });
      for (const r of data.futureRates) {
        if (r.id) {
          // Only this contractor's own free-form rows are updatable.
          await tx.contractorRate.updateMany({
            where: { id: r.id, contractorId: params.id, activityId: null },
            data: { description: r.description, unit: r.unit, rate: r.rate, note: r.note ?? null },
          });
        } else {
          await tx.contractorRate.create({
            data: {
              contractorId: params.id,
              description: r.description,
              unit: r.unit,
              rate: r.rate,
              note: r.note ?? null,
            },
          });
        }
      }
    }
  });

  const rates = await prisma.contractorRate.findMany({
    where: { contractorId: params.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ rates });
});
