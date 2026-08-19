import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const reviewSchema = z.object({
  status: z.enum(["acknowledged", "resolved"]),
  reviewNote: z.string().trim().max(1000).optional(),
});

// Owner review of an audit flag. The flag row keeps who reviewed and why.
export const PATCH = withApi(async (req: NextRequest, params) => {
  const flag = await prisma.auditFlag.findUnique({ where: { id: params.id } });
  if (!flag) throw new ApiError(404, "Flag not found");
  const ctx = await guard("flags.review", { siteId: flag.siteId });
  const body = reviewSchema.parse(await req.json());

  const updated = await prisma.auditFlag.update({
    where: { id: params.id },
    data: {
      status: body.status,
      reviewNote: body.reviewNote,
      reviewedById: ctx.userId,
    },
  });
  return NextResponse.json({ flag: updated });
});
