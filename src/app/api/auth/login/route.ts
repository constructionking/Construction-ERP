import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

const loginSchema = z.object({
  identifier: z.string().min(1), // email or phone
  password: z.string().min(1),
});

// Simple in-memory limiter: 10 attempts / 15 min per identifier+IP.
const attempts = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

export const POST = withApi(async (req: NextRequest) => {
  const { identifier, password } = loginSchema.parse(await req.json());
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(`${identifier.toLowerCase()}:${ip}`)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
      isActive: true,
    },
    include: { siteRoles: true },
  });

  // Constant-shape response for wrong user vs wrong password.
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(user.id);

  // Landing page by role priority: owner → dashboard, engineer → site page,
  // accounts → approvals queue.
  let landing = "/no-access";
  if (user.isOwner) landing = "/dashboard";
  else {
    const engineerSite = user.siteRoles.find((r) => r.role === "engineer");
    const accountsRole = user.siteRoles.find((r) => r.role === "accounts");
    if (engineerSite) landing = `/site/${engineerSite.siteId}`;
    else if (accountsRole) landing = "/approvals";
  }

  const res = NextResponse.json({ ok: true, landing });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
