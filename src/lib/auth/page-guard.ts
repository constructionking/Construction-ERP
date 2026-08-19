import { redirect } from "next/navigation";
import { loadCtx } from "./guard";
import type { AuthCtx } from "./policies";
import type { Role } from "@prisma/client";

/** For server components: session or redirect to login. */
export async function pageCtx(): Promise<AuthCtx> {
  const ctx = await loadCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Page-level role gate. Owner passes everywhere (read access to all views). */
export async function requireSiteRolePage(siteId: string, roles: Role[]): Promise<AuthCtx> {
  const ctx = await pageCtx();
  if (ctx.isOwner) return ctx;
  const role = ctx.siteRoles.get(siteId);
  if (!role || !roles.includes(role)) redirect("/no-access");
  return ctx;
}
