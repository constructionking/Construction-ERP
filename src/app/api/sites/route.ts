import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx } from "@/lib/auth/guard";
import { allowedSiteIds } from "@/lib/auth/policies";

export const GET = withApi(async () => {
  const ctx = await requireCtx();
  const siteIds = allowedSiteIds(ctx);
  const sites = await prisma.site.findMany({
    where: siteIds === null ? {} : { id: { in: siteIds } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ sites });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Z0-9-]+$/, "Code must be A-Z, 0-9, dashes"),
  location: z.string().trim().max(200).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => new Date(s))
    .optional(),
});

export const POST = withApi(async (req: NextRequest) => {
  await guard("site.manage");
  const data = createSchema.parse(await req.json());
  const site = await prisma.site.create({ data });
  return NextResponse.json({ site }, { status: 201 });
});
