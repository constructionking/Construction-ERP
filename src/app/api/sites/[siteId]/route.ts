import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

export const GET = withApi(async (_req, params) => {
  const siteId = params.siteId;
  await guard("site.view", { siteId });
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { activities: { orderBy: { sequence: "asc" } } },
  });
  if (!site) throw new ApiError(404, "Site not found");
  return NextResponse.json({ site });
});

const patchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  location: z.string().trim().max(200).optional(),
  status: z.enum(["active", "on_hold", "completed"]).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => new Date(s))
    .optional(),
});

export const PATCH = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("site.manage", { siteId });
  const data = patchSchema.parse(await req.json());
  const site = await prisma.site.update({ where: { id: siteId }, data });
  return NextResponse.json({ site });
});
