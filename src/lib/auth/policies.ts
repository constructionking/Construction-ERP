import type { Role } from "@prisma/client";

// Declarative authorization map: one action string per protected operation.
// Rules:
//   { owner: true }                       — owner only
//   { roles: [...], scope: "site" }       — listed roles ON THAT SITE
//                                           (the owner always passes — they
//                                            hold every right globally)
//   { anyRole: true }                     — any authenticated user with a role
//                                           on the site (or the owner)
// The guard evaluates these server-side with roles freshly read from the DB.

export type PolicyRule =
  | { owner: true }
  | { roles: Role[]; scope: "site" }
  | { anyRole: true };

export const policies = {
  // --- site & configuration (owner) ---
  "site.manage": { owner: true },
  "activity.manage": { owner: true },
  "baseline.lock": { owner: true },
  "schedule.suggest": { owner: true },
  "benchmark.set": { owner: true },
  "amendmentPolicy.set": { owner: true },
  "dayclose.manual": { owner: true },
  "mix.manage": { owner: true },
  "material.manage": { owner: true },
  "worktype.manage": { owner: true },

  // --- owner analytics / finance ---
  "dashboard.view": { owner: true },
  "dashboard.finance.view": { owner: true },
  "flags.review": { owner: true },
  "amendments.review": { owner: true },

  // --- engineer site operations ---
  "site.view": { anyRole: true },
  // Operational site data (progress, stock, photos, scans, labour, MB):
  // engineers only — accounts personnel see nothing beyond fund requests.
  "site.ops.view": { roles: ["engineer"], scope: "site" },
  "progress.create": { roles: ["engineer"], scope: "site" },
  "mb.upload": { roles: ["engineer"], scope: "site" },
  "photo.upload": { roles: ["engineer"], scope: "site" },
  "receipt.create": { roles: ["engineer"], scope: "site" },
  "consumption.create": { roles: ["engineer"], scope: "site" },
  "scan.create": { roles: ["engineer"], scope: "site" },
  "scan.decide": { roles: ["engineer"], scope: "site" },
  "requisition.create": { roles: ["engineer"], scope: "site" },
  "labour.create": { roles: ["engineer"], scope: "site" },
  "labour.closePeriod": { roles: ["engineer"], scope: "site" },

  // --- approvals ---
  // Accounts receives ONLY fund-allocation requests; material requisitions
  // go to the owner in Phase 1 (purchase department arrives in Phase 2).
  "requisition.approve.fund": { roles: ["accounts"], scope: "site" },
  "requisition.approve.material": { owner: true },
  // Final say on money going out: after accounts approves a fund request it
  // lands with the owner; only after owner approval can accounts release.
  "requisition.finalApprove": { owner: true },
  "requisition.view.fund": { roles: ["accounts"], scope: "site" },

  // --- amendments (window + actor rules applied on top by the versioning engine) ---
  "record.amend": { anyRole: true },
} as const satisfies Record<string, PolicyRule>;

export type PolicyAction = keyof typeof policies;

export interface AuthCtx {
  userId: string;
  name: string;
  isOwner: boolean;
  /** siteId -> role for every site this user is assigned to */
  siteRoles: ReadonlyMap<string, Role>;
}

/** Pure decision function — unit-tested exhaustively in tests/unit/policies.test.ts */
export function isAllowed(ctx: AuthCtx, action: PolicyAction, siteId?: string): boolean {
  // The owner holds every right on every site (all owner edits are still
  // forced through the reasoned-amendment path by the versioning engine).
  if (ctx.isOwner) return true;

  const rule: PolicyRule = policies[action];

  if ("owner" in rule) return false;

  if ("anyRole" in rule) {
    if (!siteId) return false;
    return ctx.siteRoles.has(siteId);
  }

  if (!siteId) return false;
  const role = ctx.siteRoles.get(siteId);
  return role !== undefined && (rule.roles as readonly Role[]).includes(role);
}

/** Sites the context may read at all (owner: unrestricted → returns null). */
export function allowedSiteIds(ctx: AuthCtx): string[] | null {
  if (ctx.isOwner) return null;
  return [...ctx.siteRoles.keys()];
}
