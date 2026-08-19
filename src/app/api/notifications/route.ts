import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { requireCtx } from "@/lib/auth/guard";

export const GET = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  const notifications = await prisma.notification.findMany({
    where: { userId: ctx.userId, readAt: unreadOnly ? null : undefined },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ notifications });
});

const markSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

// Mark own notifications read.
export const PATCH = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const { ids } = markSchema.parse(await req.json());
  await prisma.notification.updateMany({
    where: { id: { in: ids }, userId: ctx.userId },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
