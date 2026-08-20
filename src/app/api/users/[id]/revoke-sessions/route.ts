import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

// Owner force-logout: bumps the user's tokenVersion (every session token dies
// on its next request) and removes their push subscriptions. Use when a phone
// is lost/stolen or a person leaves the company.
export const POST = withApi(async (_req, params) => {
  const userId = z.string().uuid().parse(params.id);
  await guard("site.manage"); // owner-only

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
  ]);

  return NextResponse.json({ ok: true });
});
