import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "erp_session";
const SESSION_DAYS = 7;

const secret = new TextEncoder().encode(env.AUTH_SECRET);

// The token carries the user id + the user's tokenVersion. Roles and owner
// status are re-read from the database on every guarded request, and a
// tokenVersion mismatch (password change / owner-forced logout) invalidates
// every outstanding token for that user instantly.
export interface SessionClaims {
  userId: string;
  tokenVersion: number;
}

export async function createSessionToken(
  userId: string,
  tokenVersion: number
): Promise<string> {
  return new SignJWT({ sub: userId, tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return {
      userId: payload.sub,
      tokenVersion: typeof payload.tv === "number" ? payload.tv : 0,
    };
  } catch {
    return null;
  }
}

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
