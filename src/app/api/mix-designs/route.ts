import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx } from "@/lib/auth/guard";

export const GET = withApi(async () => {
  await requireCtx();
  const mixDesigns = await prisma.mixDesign.findMany({
    include: { coefficients: true },
    orderBy: { code: "asc" },
  });
  return NextResponse.json({ mixDesigns });
});

const createSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(160),
  // Basis of the coefficients: per m³ (CUM), per m² (SQM), per running
  // metre (MTR), per joint/number (NOS)…
  outputUnit: z.enum(["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"]).optional(),
  // locked → audit flags raise; provisional → flags say "(provisional rate)";
  // tbd → consumption reported, never flagged (rate not fixed yet).
  status: z.enum(["locked", "provisional", "tbd"]).optional(),
  note: z.string().trim().max(300).nullable().optional(),
  coefficients: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        qtyPerUnit: z.number().positive(), // per 1 output unit
      })
    )
    .min(1),
});

export const POST = withApi(async (req: NextRequest) => {
  await guard("mix.manage");
  const data = createSchema.parse(await req.json());
  const mix = await prisma.mixDesign.create({
    data: {
      code: data.code.toUpperCase(),
      name: data.name,
      outputUnit: data.outputUnit ?? "CUM",
      status: data.status ?? "locked",
      note: data.note ?? null,
      coefficients: { create: data.coefficients },
    },
    include: { coefficients: true },
  });
  return NextResponse.json({ mix }, { status: 201 });
});
