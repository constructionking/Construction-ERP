import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { checkLockout, recordAttempt } from "@/lib/auth/lockout";

const loginSchema = z.object({
  identifier: z.string().min(1).max(200), // email or phone
  password: z.string().min(1).max(200),
});

// Hashing a dummy password on every miss keeps response timing identical for
// unknown-user vs wrong-password — no account enumeration via timing.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-dummy-password", 12);

export const POST = withApi(async (req: NextRequest) => {
  const { identifier, password } = loginSchema.parse(await req.json());
  const normalized = identifier.toLowerCase().trim();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  // Durable, DB-backed brute-force brake (per account + per IP).
  const lock = await checkLockout(normalized, ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalized }, { phone: identifier.trim() }],
      isActive: true,
    },
    include: { siteRoles: true },
  });

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  await recordAttempt(normalized, ip, Boolean(user && ok));

  if (!user || !ok) {
    // Generic message either way — no signal about which part was wrong.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(user.id, user.tokenVersion);

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
