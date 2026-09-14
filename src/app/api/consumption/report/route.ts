import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { runConsumptionAudit } from "@/lib/audit/engine";

// Daily consumption REPORT: one activity, every material actually used on
// it today (cement, coarse sand, steel…) in one submit. Each line becomes an
// ordinary append-only ConsumptionEntry, so stock, amendments and the
// consumption audit all keep working unchanged.
const bodySchema = z.object({
  siteId: z.string().uuid(),
  activityId: z.string().uuid(),
  mixDesignId: z.string().uuid().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        qty: z.number().positive().max(10_000_000),
      })
    )
    .min(1)
    .max(30),
});

export const POST = withApi(async (req: NextRequest) => {
  const data = bodySchema.parse(await req.json());
  const ctx = await guard("consumption.create", { siteId: data.siteId });

  const activity = await prisma.activity.findUnique({ where: { id: data.activityId } });
  if (!activity || activity.siteId !== data.siteId) {
    throw new ApiError(400, "Activity does not belong to this site");
  }
  if (activity.isGroup) {
    throw new ApiError(
      400,
      `"${activity.name}" is a main activity heading — report consumption against a sub-activity under it`
    );
  }
  if (data.mixDesignId) {
    const mix = await prisma.mixDesign.findUnique({ where: { id: data.mixDesignId } });
    if (!mix) throw new ApiError(400, "Unknown mix design");
  }

  // Merge duplicate material lines; verify every material exists.
  const qtyByMaterial = new Map<string, number>();
  for (const line of data.lines) {
    qtyByMaterial.set(line.materialId, (qtyByMaterial.get(line.materialId) ?? 0) + line.qty);
  }
  const materials = await prisma.material.findMany({
    where: { id: { in: [...qtyByMaterial.keys()] } },
    select: { id: true },
  });
  if (materials.length !== qtyByMaterial.size) throw new ApiError(400, "Unknown material in report");

  const entryDate = new Date(data.entryDate);
  const entries = await prisma.$transaction(
    [...qtyByMaterial.entries()].map(([materialId, qty]) =>
      prisma.consumptionEntry.create({
        data: {
          siteId: data.siteId,
          activityId: data.activityId,
          materialId,
          mixDesignId: data.mixDesignId ?? null,
          qty,
          entryDate,
          status: "submitted",
          createdById: ctx.userId,
        },
      })
    )
  );

  // One audit pass for the whole report (theoretical = mix × progress).
  const findings = await runConsumptionAudit({
    siteId: data.siteId,
    activityId: data.activityId,
    mixDesignId: data.mixDesignId ?? null,
  }).catch((err) => {
    console.error("consumption audit failed", err);
    return null;
  });

  return NextResponse.json(
    { entries, flagged: findings ? findings.map((f) => f.materialId) : [] },
    { status: 201 }
  );
});
