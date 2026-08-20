import { describe, it, expect } from "vitest";
import {
  deriveState,
  ACCOUNTS_FUND_ACTIONS,
  OWNER_FUND_ACTIONS,
} from "@/lib/requisitions";
import type { ApprovalActionType } from "@prisma/client";

const T0 = new Date("2026-08-01T10:00:00Z");

function actions(...types: ApprovalActionType[]) {
  return types.map((action, i) => ({
    action,
    createdAt: new Date(T0.getTime() + (i + 1) * 60_000),
  }));
}

const current = { createdAt: T0 };

describe("fund request lifecycle (engineer → accounts → owner → release)", () => {
  it("starts pending", () => {
    expect(deriveState("fund", current, [])).toBe("pending");
  });

  it("accounts approval hands it to the OWNER, not straight to money", () => {
    expect(deriveState("fund", current, actions("approved"))).toBe("awaiting_owner");
    expect(deriveState("fund", current, actions("partially_approved"))).toBe("awaiting_owner");
  });

  it("owner approval hands it back to ACCOUNTS for the actual release", () => {
    expect(deriveState("fund", current, actions("approved", "owner_approved"))).toBe(
      "awaiting_release"
    );
  });

  it("release is terminal", () => {
    expect(
      deriveState("fund", current, actions("approved", "owner_approved", "released"))
    ).toBe("released");
  });

  it("rejection is terminal at either level", () => {
    expect(deriveState("fund", current, actions("rejected"))).toBe("rejected");
    expect(deriveState("fund", current, actions("approved", "owner_rejected"))).toBe(
      "owner_rejected"
    );
  });

  it("a query hands it back; resubmission returns it to the accounts queue", () => {
    expect(deriveState("fund", current, actions("queried"))).toBe("queried");
    const resubmitted = { createdAt: new Date(T0.getTime() + 10 * 60_000) };
    expect(deriveState("fund", resubmitted, actions("queried"))).toBe("resubmitted");
  });

  it("accounts may NOT release before the owner approves", () => {
    expect(ACCOUNTS_FUND_ACTIONS["awaiting_owner"]).not.toContain("released");
    expect(ACCOUNTS_FUND_ACTIONS["pending"]).not.toContain("released");
    expect(ACCOUNTS_FUND_ACTIONS["awaiting_release"]).toContain("released");
  });

  it("accounts may not double-approve once it is with the owner or released", () => {
    expect(ACCOUNTS_FUND_ACTIONS["awaiting_owner"]).toEqual([]);
    expect(ACCOUNTS_FUND_ACTIONS["released"]).toEqual([]);
  });

  it("the owner acts only while the request is awaiting them", () => {
    expect(OWNER_FUND_ACTIONS["awaiting_owner"]).toEqual(["owner_approved", "owner_rejected"]);
    expect(OWNER_FUND_ACTIONS["pending"]).toEqual([]);
    expect(OWNER_FUND_ACTIONS["awaiting_release"]).toEqual([]);
    expect(OWNER_FUND_ACTIONS["released"]).toEqual([]);
  });
});

describe("material request lifecycle (single-step owner decision)", () => {
  it("approved is terminal for material — no owner/release chain", () => {
    expect(deriveState("material", current, actions("approved"))).toBe("approved");
    expect(deriveState("material", current, actions("rejected"))).toBe("rejected");
    expect(deriveState("material", current, [])).toBe("pending");
  });
});
