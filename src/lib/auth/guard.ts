import { cache } from "react";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "./session";
import { isAllowed, type AuthCtx, type PolicyAction } from "./policies";
import { ApiError } from "@/lib/errors";

export { ApiError };

// Per-request memoized context load (React `cache`), so multiple guards in one
// request hit the database once — but every REQUEST re-reads roles from DB.
export const loadCtx = cache(async (): Promise<AuthCtx | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { siteRoles: true },
  });
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    name: user.name,
    isOwner: user.isOwner,
    siteRoles: new Map(user.siteRoles.map((r) => [r.siteId, r.role])),
  };
});

export async function requireCtx(): Promise<AuthCtx> {
  const ctx = await loadCtx();
  if (!ctx) throw new ApiError(401, "Not signed in");
  return ctx;
}

/**
 * Authorization gate — called at the top of every protected route handler and
 * server action. Throws 401/403; returns the context on success.
 */
export async function guard(action: PolicyAction, opts?: { siteId?: string }): Promise<AuthCtx> {
  const ctx = await requireCtx();
  if (!isAllowed(ctx, action, opts?.siteId)) {
    throw new ApiError(403, "You do not have permission for this action");
  }
  return ctx;
}
