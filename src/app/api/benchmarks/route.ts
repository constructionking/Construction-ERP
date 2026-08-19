import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { unitEnum } from "@/lib/versioning/schemas";

// Benchmark history is append-only: a new rate supersedes by effective date.
export const GET = withApi(async () => {
  await guard("benchmark.set");
  const benchmarks = await prisma.benchmarkRate.findMany({
    orderBy: [{ workTypeId: "asc" }, { effectiveFrom: "desc" }],
  });
  return NextResponse.json({ benchmarks });
});

const createSchema = z.object({
  workTypeId: z.string().uuid(),
  unit: unitEnum,
  benchmarkCostPerUnit: z.number().positive().max(10_000_000),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => new Date(s)),
});

export const POST = withApi(async (req: NextRequest) => {
  const ctx = await guard("benchmark.set");
  const data = createSchema.parse(await req.json());
  const benchmark = await prisma.benchmarkRate.create({
    data: { ...data, setById: ctx.userId },
  });
  return NextResponse.json({ benchmark }, { status: 201 });
});
