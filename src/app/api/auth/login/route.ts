import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { withLoginGate } from "@/lib/auth/lockout";
import { clientIp } from "@/lib/auth/client-ip";

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
  const ip = clientIp(req);

  // Resolve the user up-front so the lockout is keyed on the canonical account
  // id — an attacker cannot get two independent failure buckets by alternating
  // the same person's email and phone. Unknown user → a stable per-identifier
  // key so brute force against a non-existent account is still throttled.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalized }, { phone: identifier.trim() }],
      isActive: true,
    },
    include: { siteRoles: true },
  });
  const lockKey = user ? `uid:${user.id}` : `id:${normalized}`;

  const gate = await withLoginGate(lockKey, ip, () =>
    // bcrypt runs inside the per-account advisory lock; the dummy hash keeps
    // timing constant when the user does not exist.
    bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
  );

  if (gate.status === "locked") {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  if (!user || !gate.ok) {
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
