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
  coefficients: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        qtyPerUnit: z.number().positive(), // per 1 CUM of output
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
      coefficients: { create: data.coefficients },
    },
    include: { coefficients: true },
  });
  return NextResponse.json({ mix }, { status: 201 });
});
