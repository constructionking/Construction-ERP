import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx } from "@/lib/auth/guard";
import { unitEnum } from "@/lib/versioning/schemas";

export const GET = withApi(async () => {
  await requireCtx(); // material master is shared reference data for all roles
  const materials = await prisma.material.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ materials });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  unit: unitEnum,
  category: z.enum(["cement", "sand", "aggregate", "brick", "steel", "other"]),
  spec: z.string().trim().max(200).optional(),
  densityKgPerCum: z.number().positive().optional(),
  unitsPerCum: z.number().positive().optional(),
});

export const POST = withApi(async (req: NextRequest) => {
  await guard("material.manage");
  const data = createSchema.parse(await req.json());
  const material = await prisma.material.create({ data });
  return NextResponse.json({ material }, { status: 201 });
});
