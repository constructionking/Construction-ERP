import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { computeSiteStock } from "@/lib/inventory/stock";

export const GET = withApi(async (req: NextRequest) => {
  const siteId = z.string().uuid().parse(new URL(req.url).searchParams.get("siteId"));
  await guard("site.view", { siteId });
  const stock = await computeSiteStock(siteId);
  return NextResponse.json({ stock });
});
