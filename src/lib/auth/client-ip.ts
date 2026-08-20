import type { NextRequest } from "next/server";

// Client IP for rate-limiting/lockout.
//
// SECURITY / DEPLOYMENT CAVEAT: `x-forwarded-for` is fully client-controlled
// unless a trusted reverse proxy overwrites it. Deploy this app behind a proxy
// (Nginx/Cloudflare/your ingress) that STRIPS inbound XFF and sets a trusted
// forwarding header, then point TRUSTED_IP_HEADER at it. The per-ACCOUNT lock
// does not depend on IP (it is keyed on the account), so IP spoofing can at
// worst defeat the cross-account "spray" brake — never the per-account cap.
const TRUSTED_HEADER = process.env.TRUSTED_IP_HEADER || "x-real-ip";

export function clientIp(req: NextRequest): string {
  // Prefer the header the trusted proxy sets; fall back to the left-most XFF
  // hop; finally a fixed bucket so a header-less client can't spread failures
  // across many "IPs".
  const trusted = req.headers.get(TRUSTED_HEADER)?.trim();
  if (trusted) return trusted.slice(0, 64);
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff.slice(0, 64);
  return "unknown";
}
