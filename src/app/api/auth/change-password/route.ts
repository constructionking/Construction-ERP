import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { requireCtx, ApiError } from "@/lib/auth/guard";
import { validatePassword, BCRYPT_COST } from "@/lib/auth/password";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

// Changing the password bumps tokenVersion: every other device/session for
// this user is signed out instantly; this request gets a fresh token.
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const body = bodySchema.parse(await req.json());

  const policyError = validatePassword(body.newPassword);
  if (policyError) throw new ApiError(400, policyError);

  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw new ApiError(401, "Not signed in");
  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) throw new ApiError(403, "Current password is incorrect");

  const updated = await prisma.user.update({
    where: { id: ctx.userId },
    data: {
      passwordHash: await bcrypt.hash(body.newPassword, BCRYPT_COST),
      tokenVersion: { increment: 1 },
    },
  });

  const token = await createSessionToken(updated.id, updated.tokenVersion);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
