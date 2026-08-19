import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";

const listQuery = z.object({
  siteId: z.string().uuid().optional(),
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("flags.review", q.siteId ? { siteId: q.siteId } : undefined);
  const flags = await prisma.auditFlag.findMany({
    where: { siteId: q.siteId, status: q.status },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ flags });
});
