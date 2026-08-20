import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { requireCtx } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { pushEnabled } from "@/lib/push";

// GET: the VAPID public key the browser needs to subscribe.
export const GET = withApi(async () => {
  await requireCtx();
  return NextResponse.json({
    enabled: pushEnabled(),
    publicKey: env.VAPID_PUBLIC_KEY || null,
  });
});

const subscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "Push endpoints must be https"),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(200),
  }),
});

const MAX_SUBSCRIPTIONS_PER_USER = 10;

// POST: register (or re-register) this device's push subscription.
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const body = subscribeSchema.parse(await req.json());
  const userAgent = req.headers.get("user-agent")?.slice(0, 200) ?? null;

  const count = await prisma.pushSubscription.count({ where: { userId: ctx.userId } });
  if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
    // Drop the oldest instead of refusing — people replace phones.
    const oldest = await prisma.pushSubscription.findFirst({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "asc" },
    });
    if (oldest) await prisma.pushSubscription.delete({ where: { id: oldest.id } });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId: ctx.userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent,
    },
    // Endpoint reused after a re-login: rebind to the current user.
    update: { userId: ctx.userId, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) });

export const DELETE = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const body = unsubscribeSchema.parse(await req.json());
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: body.endpoint, userId: ctx.userId },
  });
  return NextResponse.json({ ok: true });
});
