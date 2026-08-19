import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const POST = withApi(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
