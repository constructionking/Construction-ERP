import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { buildMbTemplate } from "@/lib/mb-parser/template";

// Site-specific template: pre-filled site code + this site's activity codes
// in the Instructions sheet.
export const GET = withApi(async (req: NextRequest) => {
  const siteId = z.string().uuid().parse(new URL(req.url).searchParams.get("siteId"));
  await guard("site.ops.view", { siteId });

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      activities: { select: { code: true, name: true, unit: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!site) throw new ApiError(404, "Site not found");

  const buffer = await buildMbTemplate({ siteCode: site.code, activityCodes: site.activities });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="measurement-book-${site.code}.xlsx"`,
    },
  });
});
