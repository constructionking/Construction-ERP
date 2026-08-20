import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, resetDb, makeUser, makeSite } from "../helpers/db";
import { deriveState } from "@/lib/requisitions";
import { releaseLog } from "@/lib/reports/releases";
import { checkLockout, recordAttempt, withLoginGate } from "@/lib/auth/lockout";

let siteId: string;
let engineerId: string;
let accountsId: string;
let ownerId: string;

beforeAll(async () => {
  await resetDb();
  const site = await makeSite("FCH");
  siteId = site.id;
  engineerId = (await makeUser({ email: "eng@fch" })).id;
  accountsId = (await makeUser({ email: "acc@fch" })).id;
  ownerId = (await makeUser({ email: "own@fch", isOwner: true })).id;
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("fund chain against real rows", () => {
  it("full chain lands in the release log with the complete sign-off trail", async () => {
    const requisition = await testDb.requisition.create({
      data: {
        siteId,
        kind: "fund",
        lines: [{ head: "Shuttering material advance", amount: 40000 }],
        amountTotal: 40000,
        justification: "Slab shuttering for block B",
        status: "submitted",
        createdById: engineerId,
      },
    });

    const step = async (action: string, actorId: string, approvedAmount?: number) =>
      testDb.approvalAction.create({
        data: {
          requisitionEntityId: requisition.entityId,
          action: action as never,
          actorId,
          approvedAmount,
          reason: action === "partially_approved" ? "diesel head looks high" : undefined,
        },
      });

    // Accounts proposes a change → back with the engineer
    await step("partially_approved", accountsId, 35000);
    let actions = await testDb.approvalAction.findMany({
      where: { requisitionEntityId: requisition.entityId },
    });
    expect(deriveState("fund", requisition, actions)).toBe("changes_requested");

    // Engineer resubmits (new current version AFTER that action)
    const revised = await testDb.$transaction(async (tx) => {
      const next = await tx.requisition.create({
        data: {
          siteId,
          kind: "fund",
          entityId: requisition.entityId,
          version: 2,
          isCurrent: false,
          lines: [{ head: "Shuttering material advance", amount: 35000 }],
          amountTotal: 35000,
          justification: "Slab shuttering for block B (revised per accounts)",
          status: "submitted",
          createdById: engineerId,
          amendmentReason: "revised to the amount accounts proposed",
          amendedFromId: requisition.id,
        },
      });
      await tx.requisition.update({
        where: { id: requisition.id },
        data: { isCurrent: false, status: "superseded" },
      });
      await tx.requisition.update({ where: { id: next.id }, data: { isCurrent: true } });
      return next;
    });
    expect(deriveState("fund", revised, actions)).toBe("resubmitted");

    // Accounts approves AS-IS → owner → release
    await step("approved", accountsId);
    await step("owner_approved", ownerId);
    await step("released", accountsId);
    actions = await testDb.approvalAction.findMany({
      where: { requisitionEntityId: requisition.entityId },
    });
    expect(deriveState("fund", revised, actions)).toBe("released");

    // The owner's dated & timed release log carries the full trail.
    const log = await releaseLog(siteId);
    expect(log.rows).toHaveLength(1);
    const row = log.rows[0];
    expect(row.amount).toBe(35000);
    expect(row.raisedBy).toBe("eng");
    expect(row.accountsApprovedBy).toBe("acc");
    expect(row.ownerApprovedBy).toBe("own");
    expect(row.releasedBy).toBe("acc");
    expect(row.releasedAt).toBeInstanceOf(Date);
    expect(row.heads[0]).toContain("Shuttering material advance");
    expect(log.totalReleased).toBe(35000);
  });
});

describe("durable login lockout", () => {
  it("locks the account after 5 failures and reports retry-after", async () => {
    const id = "bruteforce@test";
    for (let i = 0; i < 5; i++) await recordAttempt(id, "9.9.9.9", false);
    const lock = await checkLockout(id, "9.9.9.9");
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSeconds).toBeGreaterThan(0);

    // A different account from a different IP is unaffected.
    const other = await checkLockout("someone-else@test", "8.8.8.8");
    expect(other.locked).toBe(false);
  });

  it("a success resets the consecutive-failure count", async () => {
    const id = "recovers@test";
    for (let i = 0; i < 4; i++) await recordAttempt(id, "7.7.7.7", false);
    await recordAttempt(id, "7.7.7.7", true);
    for (let i = 0; i < 3; i++) await recordAttempt(id, "7.7.7.7", false);
    const lock = await checkLockout(id, "7.7.7.7");
    expect(lock.locked).toBe(false);
  });

  it("PARALLEL wrong guesses cannot exceed the threshold (advisory-lock race closed)", async () => {
    const id = "parallel@test";
    // Fire 30 simultaneous failing attempts for one account.
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        withLoginGate(id, "6.6.6.6", async () => false)
      )
    );
    const admitted = results.filter((r) => r.status === "done").length;
    const locked = results.filter((r) => r.status === "locked").length;
    // At most the threshold (5) get past the gate; the rest are locked out.
    expect(admitted).toBeLessThanOrEqual(5);
    expect(locked).toBeGreaterThanOrEqual(25);
  });

  it("the gate admits a correct password and does not lock a clean account", async () => {
    const id = "cleanlogin@test";
    const r = await withLoginGate(id, "5.5.5.5", async () => true);
    expect(r).toEqual({ status: "done", ok: true });
  });
});
