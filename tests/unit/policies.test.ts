import { describe, it, expect } from "vitest";
import {
  isAllowed,
  allowedSiteIds,
  policies,
  type AuthCtx,
  type PolicyAction,
} from "@/lib/auth/policies";

const SITE_A = "11111111-1111-1111-1111-111111111111";
const SITE_B = "22222222-2222-2222-2222-222222222222";

function ctx(partial: Partial<AuthCtx>): AuthCtx {
  return {
    userId: "u",
    name: "Test",
    isOwner: false,
    siteRoles: new Map(),
    ...partial,
  };
}

const owner = ctx({ isOwner: true });
const engineerA = ctx({ siteRoles: new Map([[SITE_A, "engineer"]]) });
const accountsA = ctx({ siteRoles: new Map([[SITE_A, "accounts"]]) });
const noRole = ctx({});

const allActions = Object.keys(policies) as PolicyAction[];

describe("RBAC policy matrix", () => {
  it("owner passes every action on every site", () => {
    for (const action of allActions) {
      expect(isAllowed(owner, action, SITE_A), action).toBe(true);
      expect(isAllowed(owner, action), action).toBe(true);
    }
  });

  it("engineer: allowed site operations on OWN site only", () => {
    const engineerActions: PolicyAction[] = [
      "progress.create",
      "mb.upload",
      "photo.upload",
      "receipt.create",
      "consumption.create",
      "scan.create",
      "scan.decide",
      "requisition.create",
      "labour.create",
      "labour.closePeriod",
      "site.view",
      "site.ops.view",
      "record.amend",
    ];
    for (const action of engineerActions) {
      expect(isAllowed(engineerA, action, SITE_A), `${action} on own site`).toBe(true);
      expect(isAllowed(engineerA, action, SITE_B), `${action} on other site`).toBe(false);
      expect(isAllowed(engineerA, action), `${action} without site`).toBe(false);
    }
  });

  it("engineer is blocked from every owner/finance action", () => {
    const forbidden: PolicyAction[] = [
      "site.manage",
      "activity.manage",
      "baseline.lock",
      "schedule.suggest",
      "benchmark.set",
      "amendmentPolicy.set",
      "dayclose.manual",
      "mix.manage",
      "material.manage",
      "worktype.manage",
      "dashboard.view",
      "dashboard.finance.view",
      "flags.review",
      "amendments.review",
      "requisition.approve.material",
    ];
    for (const action of forbidden) {
      expect(isAllowed(engineerA, action, SITE_A), action).toBe(false);
    }
  });

  it("engineer cannot approve or view fund requisitions (accounts-only)", () => {
    expect(isAllowed(engineerA, "requisition.approve.fund", SITE_A)).toBe(false);
    expect(isAllowed(engineerA, "requisition.view.fund", SITE_A)).toBe(false);
  });

  it("accounts: fund approvals on own site only, nothing else", () => {
    expect(isAllowed(accountsA, "requisition.approve.fund", SITE_A)).toBe(true);
    expect(isAllowed(accountsA, "requisition.view.fund", SITE_A)).toBe(true);
    expect(isAllowed(accountsA, "requisition.approve.fund", SITE_B)).toBe(false);
    expect(isAllowed(accountsA, "site.view", SITE_A)).toBe(true);

    const forbidden: PolicyAction[] = [
      "progress.create",
      "mb.upload",
      "receipt.create",
      "consumption.create",
      "scan.create",
      "requisition.create",
      "labour.create",
      "dashboard.view",
      "dashboard.finance.view",
      "baseline.lock",
      "flags.review",
      "requisition.approve.material",
      // Accounts must not see site operations data at all — fund requests only.
      "site.ops.view",
    ];
    for (const action of forbidden) {
      expect(isAllowed(accountsA, action, SITE_A), action).toBe(false);
    }
  });

  it("user with no roles can do nothing site-scoped", () => {
    for (const action of allActions) {
      expect(isAllowed(noRole, action, SITE_A), action).toBe(false);
    }
  });

  it("allowedSiteIds: owner unrestricted (null), others limited to their sites", () => {
    expect(allowedSiteIds(owner)).toBeNull();
    expect(allowedSiteIds(engineerA)).toEqual([SITE_A]);
    expect(allowedSiteIds(noRole)).toEqual([]);
  });
});
