import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";

export const GET = withApi(async (_req, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const contractors = await prisma.contractor.findMany({
    where: { siteId },
    include: { rates: { orderBy: { createdAt: "asc" } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ contractors });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional(),
});

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const data = createSchema.parse(await req.json());
  const contractor = await prisma.contractor.create({
    data: { siteId, name: data.name, phone: data.phone || null },
  });
  return NextResponse.json({ contractor }, { status: 201 });
});
