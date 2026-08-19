import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, resetDb, makeUser, makeSite } from "../helpers/db";
import { amendRecord } from "@/lib/versioning/amend";
import type { AuthCtx } from "@/lib/auth/policies";

let siteId: string;
let engineerId: string;
let ownerId: string;
let activityId: string;

function engineerCtx(): AuthCtx {
  return {
    userId: engineerId,
    name: "Engineer",
    isOwner: false,
    siteRoles: new Map([[siteId, "engineer"]]),
  };
}

function ownerCtx(): AuthCtx {
  return { userId: ownerId, name: "Owner", isOwner: true, siteRoles: new Map() };
}

async function createSubmittedProgress(overrides: Record<string, unknown> = {}) {
  return testDb.progressEntry.create({
    data: {
      siteId,
      activityId,
      entryDate: new Date("2026-08-19"),
      qtyDone: 12.5,
      unit: "CUM",
      executedBy: "dept",
      status: "submitted",
      createdById: engineerId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  await resetDb();
  const site = await makeSite("IMM");
  siteId = site.id;
  const engineer = await makeUser({ email: "eng@test" });
  engineerId = engineer.id;
  const owner = await makeUser({ email: "own@test", isOwner: true });
  ownerId = owner.id;
  await testDb.siteRole.create({ data: { userId: engineerId, siteId, role: "engineer" } });
  const activity = await testDb.activity.create({
    data: { siteId, code: "FND", name: "Foundation", unit: "CUM" },
  });
  activityId = activity.id;
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("database-level immutability triggers", () => {
  it("rejects raw UPDATE of business fields on a submitted row", async () => {
    const row = await createSubmittedProgress();
    await expect(
      testDb.$executeRawUnsafe(
        `UPDATE progress_entries SET "qtyDone" = 999 WHERE id = '${row.id}'`
      )
    ).rejects.toThrow(/append_only/);
  });

  it("rejects DELETE of a submitted row", async () => {
    const row = await createSubmittedProgress();
    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM progress_entries WHERE id = '${row.id}'`)
    ).rejects.toThrow(/append_only/);
  });

  it("allows editing and deleting DRAFT rows", async () => {
    const draft = await createSubmittedProgress({ status: "draft" });
    await testDb.progressEntry.update({ where: { id: draft.id }, data: { qtyDone: 20 } });
    await testDb.progressEntry.delete({ where: { id: draft.id } });
  });

  it("freezes superseded rows completely", async () => {
    const row = await createSubmittedProgress();
    await testDb.progressEntry.update({
      where: { id: row.id },
      data: { isCurrent: false, status: "superseded" },
    });
    await expect(
      testDb.$executeRawUnsafe(
        `UPDATE progress_entries SET status = 'submitted' WHERE id = '${row.id}'`
      )
    ).rejects.toThrow(/frozen/);
  });

  it("forbids UPDATE and DELETE on approval_actions (append-only decision log)", async () => {
    const action = await testDb.approvalAction.create({
      data: {
        requisitionEntityId: "00000000-0000-0000-0000-000000000001",
        action: "approved",
        actorId: engineerId,
      },
    });
    await expect(
      testDb.$executeRawUnsafe(
        `UPDATE approval_actions SET action = 'rejected' WHERE id = '${action.id}'`
      )
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM approval_actions WHERE id = '${action.id}'`)
    ).rejects.toThrow(/immutable/);
  });

  it("photos: only the supersede fields may ever be set, and only once", async () => {
    const photo = await testDb.photo.create({
      data: {
        siteId,
        storageKey: "k1",
        uploadedById: engineerId,
        kind: "progress",
      },
    });
    await expect(
      testDb.$executeRawUnsafe(`UPDATE photos SET "storageKey" = 'k2' WHERE id = '${photo.id}'`)
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM photos WHERE id = '${photo.id}'`)
    ).rejects.toThrow(/supersede/);

    await testDb.photo.update({
      where: { id: photo.id },
      data: {
        supersededReason: "wrong angle",
        supersededById: engineerId,
        supersededAt: new Date(),
      },
    });
    await expect(
      testDb.photo.update({
        where: { id: photo.id },
        data: { supersededReason: "changed my mind" },
      })
    ).rejects.toThrow();
  });

  it("baselines can never be updated or deleted", async () => {
    const baseline = await testDb.baseline.create({
      data: { siteId, version: 1, lockedById: ownerId },
    });
    await expect(
      testDb.$executeRawUnsafe(`UPDATE baselines SET version = 9 WHERE id = '${baseline.id}'`)
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM baselines WHERE id = '${baseline.id}'`)
    ).rejects.toThrow(/immutable/);
  });
});

describe("amendment engine", () => {
  it("author amends same-day record: new version, old superseded, diff logged", async () => {
    const row = await createSubmittedProgress();
    const result = await amendRecord({
      recordType: "progress_entry",
      entityId: row.entityId,
      ctx: engineerCtx(),
      actorRoleLabel: "engineer",
      reason: "typo in quantity: was 12.5, actual 14.0",
      data: {
        activityId,
        entryDate: new Date("2026-08-19"),
        qtyDone: 14.0,
        unit: "CUM",
        executedBy: "dept",
      },
    });

    expect(result.version).toBe(2);

    const versions = await testDb.progressEntry.findMany({
      where: { entityId: row.entityId },
      orderBy: { version: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].status).toBe("superseded");
    expect(versions[0].isCurrent).toBe(false);
    expect(versions[0].qtyDone.toString()).toBe("12.5");
    expect(versions[1].status).toBe("submitted");
    expect(versions[1].isCurrent).toBe(true);
    expect(versions[1].qtyDone.toString()).toBe("14");
    expect(versions[1].amendmentReason).toContain("typo");

    const log = await testDb.editLog.findFirst({ where: { entityId: row.entityId } });
    expect(log).not.toBeNull();
    expect(log!.fromVersion).toBe(1);
    expect(log!.toVersion).toBe(2);
    const diff = log!.diff as Record<string, { from: unknown; to: unknown }>;
    expect(diff.qtyDone).toEqual({ from: "12.5", to: "14" });
  });

  it("rejects amendment without a meaningful reason", async () => {
    const row = await createSubmittedProgress();
    await expect(
      amendRecord({
        recordType: "progress_entry",
        entityId: row.entityId,
        ctx: engineerCtx(),
        actorRoleLabel: "engineer",
        reason: "x",
        data: {},
      })
    ).rejects.toThrow(/reason/i);
  });

  it("rejects amendment by a non-author non-owner", async () => {
    const other = await makeUser({ email: `other-${Date.now()}@test` });
    const row = await createSubmittedProgress();
    await expect(
      amendRecord({
        recordType: "progress_entry",
        entityId: row.entityId,
        ctx: {
          userId: other.id,
          name: "Other",
          isOwner: false,
          siteRoles: new Map([[siteId, "engineer"]]),
        },
        actorRoleLabel: "engineer",
        reason: "trying to change someone else's entry",
        data: {},
      })
    ).rejects.toThrow(/original author/);
  });

  it("closes the until_day_close window for records created on a past day", async () => {
    const row = await createSubmittedProgress({
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    });
    await expect(
      amendRecord({
        recordType: "progress_entry",
        entityId: row.entityId,
        ctx: engineerCtx(),
        actorRoleLabel: "engineer",
        reason: "too late to change this now",
        data: {},
      })
    ).rejects.toThrow(/window closed/i);
  });

  it("owner may amend past the window — but the edit is logged", async () => {
    const row = await createSubmittedProgress({
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    });
    const result = await amendRecord({
      recordType: "progress_entry",
      entityId: row.entityId,
      ctx: ownerCtx(),
      actorRoleLabel: "owner",
      reason: "engineer reported wrong figure verified from MB",
      data: { qtyDone: 10 },
    });
    expect(result.version).toBe(2);
    const log = await testDb.editLog.findFirst({
      where: { entityId: row.entityId, actorRole: "owner" },
    });
    expect(log).not.toBeNull();
  });

  it("requisitions: amendable until an approver acts, frozen after", async () => {
    const req = await testDb.requisition.create({
      data: {
        siteId,
        kind: "fund",
        lines: [{ head: "Diesel advance", amount: 50000 }],
        amountTotal: 50000,
        justification: "Generator fuel for slab casting week",
        status: "submitted",
        createdById: engineerId,
      },
    });

    const ok = await amendRecord({
      recordType: "requisition",
      entityId: req.entityId,
      ctx: engineerCtx(),
      actorRoleLabel: "engineer",
      reason: "amount was underestimated",
      data: {
        kind: "fund",
        lines: [{ head: "Diesel advance", amount: 65000 }],
        amountTotal: 65000,
        justification: "Generator fuel for slab casting week",
      },
    });
    expect(ok.version).toBe(2);

    await testDb.approvalAction.create({
      data: { requisitionEntityId: req.entityId, action: "queried", actorId: ownerId, reason: "why?" },
    });

    await expect(
      amendRecord({
        recordType: "requisition",
        entityId: req.entityId,
        ctx: engineerCtx(),
        actorRoleLabel: "engineer",
        reason: "trying to change after query",
        data: {},
      })
    ).rejects.toThrow(/approver has already acted/);
  });

  it("amendment cannot move a record to another site (pinned identity)", async () => {
    const otherSite = await makeSite(`OTH${Date.now() % 10000}`);
    const row = await createSubmittedProgress();
    await amendRecord({
      recordType: "progress_entry",
      entityId: row.entityId,
      ctx: engineerCtx(),
      actorRoleLabel: "engineer",
      reason: "attempting site move via amendment",
      data: { siteId: otherSite.id, qtyDone: 5 },
    });
    const current = await testDb.progressEntry.findFirst({
      where: { entityId: row.entityId, isCurrent: true },
    });
    expect(current!.siteId).toBe(siteId); // unchanged
    expect(current!.qtyDone.toString()).toBe("5");
  });
});
