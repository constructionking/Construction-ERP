import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  outputUnit: z.enum(["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"]).optional(),
  status: z.enum(["locked", "provisional", "tbd"]).optional(),
  note: z.string().trim().max(300).nullable().optional(),
  // Full replacement of the coefficient set when provided.
  coefficients: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        qtyPerUnit: z.number().positive(),
      })
    )
    .min(1)
    .optional(),
});

// Confirm/adjust a mix: change its rate, lock a provisional one, fix a TBD
// per-joint rate… Past consumption entries keep their own submitted numbers —
// only future theoretical checks use the updated coefficients.
export const PATCH = withApi(async (req: NextRequest, params) => {
  await guard("mix.manage");
  const data = patchSchema.parse(await req.json());
  const existing = await prisma.mixDesign.findUnique({ where: { id: params.id } });
  if (!existing) throw new ApiError(404, "Mix design not found");

  const mix = await prisma.$transaction(async (tx) => {
    if (data.coefficients) {
      await tx.mixDesignCoefficient.deleteMany({ where: { mixId: params.id } });
      await tx.mixDesignCoefficient.createMany({
        data: data.coefficients.map((c) => ({ mixId: params.id, ...c })),
      });
    }
    return tx.mixDesign.update({
      where: { id: params.id },
      data: {
        name: data.name,
        outputUnit: data.outputUnit,
        status: data.status,
        note: data.note === undefined ? undefined : data.note,
      },
      include: { coefficients: true },
    });
  });
  return NextResponse.json({ mix });
});

export const DELETE = withApi(async (_req, params) => {
  await guard("mix.manage");
  const existing = await prisma.mixDesign.findUnique({ where: { id: params.id } });
  if (!existing) throw new ApiError(404, "Mix design not found");
  // Consumption history referencing the mix must survive.
  const used = await prisma.consumptionEntry.count({ where: { mixDesignId: params.id } });
  if (used > 0) {
    throw new ApiError(409, `${used} consumption records use this mix; it cannot be deleted`);
  }
  await prisma.mixDesignCoefficient.deleteMany({ where: { mixId: params.id } });
  await prisma.mixDesign.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
