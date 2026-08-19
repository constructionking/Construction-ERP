import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const assignSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  role: z.enum(["engineer", "accounts"]), // phase-2 roles assigned when built
});

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("site.manage", { siteId });
  const data = assignSchema.parse(await req.json());

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new ApiError(404, "No user with that email — create the user first");

  const role = await prisma.siteRole.upsert({
    where: { userId_siteId: { userId: user.id, siteId } },
    create: { userId: user.id, siteId, role: data.role },
    update: { role: data.role },
  });
  return NextResponse.json({ role }, { status: 201 });
});

export const DELETE = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("site.manage", { siteId });
  const email = z
    .string()
    .email()
    .transform((e) => e.toLowerCase())
    .parse(new URL(req.url).searchParams.get("email"));
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(404, "User not found");
  await prisma.siteRole.deleteMany({ where: { userId: user.id, siteId } });
  return NextResponse.json({ ok: true });
});
