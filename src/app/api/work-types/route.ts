import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx } from "@/lib/auth/guard";
import { unitEnum } from "@/lib/versioning/schemas";

export const GET = withApi(async () => {
  await requireCtx();
  const workTypes = await prisma.workType.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ workTypes });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  defaultUnit: unitEnum,
});

export const POST = withApi(async (req: NextRequest) => {
  await guard("worktype.manage");
  const data = createSchema.parse(await req.json());
  const workType = await prisma.workType.create({ data });
  return NextResponse.json({ workType }, { status: 201 });
});
