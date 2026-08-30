import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, resetDb, makeSite } from "../helpers/db";

// Exercises the grouped (structure → items) BOQ commit semantics against the
// real database — including the isGroup column and the widened category enum,
// which proves the migrations applied. Mirrors the commit route's transaction
// (kept in sync intentionally); endpoint auth is covered by policy tests.

let siteId: string;

beforeAll(async () => {
  await resetDb();
  const site = await makeSite("BOQ");
  siteId = site.id;
});

afterAll(async () => {
  await testDb.$disconnect();
});

interface ImportItem {
  code: string;
  name: string;
  category: string;
  boqQty: number;
  unit: string;
}

function groupCode(name: string, taken: Set<string>): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 14);
  let code = `MA-${slug || "GROUP"}`.slice(0, 20);
  let n = 1;
  while (taken.has(code)) {
    n++;
    code = `MA-${slug.slice(0, 11)}-${n}`.slice(0, 20);
  }
  taken.add(code);
  return code;
}

// Mirrors the commit route's transaction body.
async function commitImport(
  structures: Array<{ name: string; items: ImportItem[] }>,
  chainSequence: boolean,
) {
  return testDb.$transaction(async (tx) => {
    const existing = await tx.activity.findMany({
      where: { siteId },
      select: { id: true, code: true, name: true, sequence: true, isGroup: true },
    });
    const leafByCode = new Map(existing.filter((a) => !a.isGroup).map((a) => [a.code.toUpperCase(), a]));
    const groupByName = new Map(
      existing.filter((a) => a.isGroup).map((a) => [a.name.trim().toLowerCase(), a]),
    );
    const takenCodes = new Set(existing.map((a) => a.code.toUpperCase()));
    let seq = existing.reduce((m, a) => Math.max(m, a.sequence), 0);

    let groupsCreated = 0;
    let created = 0;
    const updatedCodes: string[] = [];
    let dependenciesCreated = 0;

    for (const structure of structures) {
      const nameKey = structure.name.trim().toLowerCase();
      let parent = groupByName.get(nameKey);
      if (!parent) {
        const row = await tx.activity.create({
          data: {
            siteId,
            code: groupCode(structure.name, takenCodes),
            name: structure.name.trim(),
            isGroup: true,
            category: "general" as never,
            sequence: ++seq,
          },
        });
        parent = { id: row.id, code: row.code, name: row.name, sequence: row.sequence, isGroup: true };
        groupByName.set(nameKey, parent);
        groupsCreated++;
      }

      const orderedIds: string[] = [];
      for (const item of structure.items) {
        const code = item.code.toUpperCase();
        const prior = leafByCode.get(code);
        if (prior) {
          await tx.activity.update({
            where: { id: prior.id },
            data: {
              name: item.name,
              category: item.category as never,
              boqQty: item.boqQty,
              unit: item.unit as never,
              parentId: parent.id,
            },
          });
          orderedIds.push(prior.id);
          updatedCodes.push(code);
        } else {
          const row = await tx.activity.create({
            data: {
              siteId,
              code,
              name: item.name,
              category: item.category as never,
              boqQty: item.boqQty,
              unit: item.unit as never,
              parentId: parent.id,
              sequence: ++seq,
            },
          });
          leafByCode.set(code, { ...row, isGroup: false });
          takenCodes.add(code);
          orderedIds.push(row.id);
          created++;
        }
      }

      if (chainSequence && orderedIds.length > 1) {
        for (let i = 0; i + 1 < orderedIds.length; i++) {
          const res = await tx.activityDependency.createMany({
            data: [{ predecessorId: orderedIds[i], successorId: orderedIds[i + 1], lagDays: 0 }],
            skipDuplicates: true,
          });
          dependenciesCreated += res.count;
        }
      }
    }
    return { groupsCreated, created, updated: updatedCodes.length, updatedCodes, dependenciesCreated };
  });
}

describe("grouped BOQ import commit semantics", () => {
  it("creates main activities (isGroup) with children and chains WITHIN each structure", async () => {
    const result = await commitImport(
      [
        {
          name: "Boundary wall",
          items: [
            { code: "1.1", name: "Excavation", category: "earthwork", boqQty: 80, unit: "CUM" },
            { code: "2.1", name: "PCC M10", category: "concreting", boqQty: 6.3, unit: "CUM" },
            { code: "2.2", name: "Bar bending Fe500", category: "reinforcement", boqQty: 2500, unit: "KG" },
          ],
        },
        {
          name: "Underground water tank",
          items: [
            { code: "T.1", name: "Tank excavation", category: "earthwork", boqQty: 120, unit: "CUM" },
            { code: "T.2", name: "Raft RCC M25", category: "concreting", boqQty: 45, unit: "CUM" },
          ],
        },
      ],
      true,
    );
    expect(result).toMatchObject({ groupsCreated: 2, created: 5, updated: 0, dependenciesCreated: 3 });

    const groups = await testDb.activity.findMany({ where: { siteId, isGroup: true }, orderBy: { sequence: "asc" } });
    expect(groups.map((g) => g.name)).toEqual(["Boundary wall", "Underground water tank"]);
    expect(groups.every((g) => g.boqQty === null && g.unit === null)).toBe(true);

    const wallKids = await testDb.activity.findMany({
      where: { parentId: groups[0].id },
      orderBy: { sequence: "asc" },
    });
    expect(wallKids.map((k) => k.code)).toEqual(["1.1", "2.1", "2.2"]);
    expect(wallKids[2].category).toBe("reinforcement"); // real PG enum value

    // No chain edge between structures: tank items depend only on each other.
    const tankKids = await testDb.activity.findMany({ where: { parentId: groups[1].id } });
    const crossDeps = await testDb.activityDependency.count({
      where: {
        predecessorId: { in: wallKids.map((k) => k.id) },
        successorId: { in: tankKids.map((k) => k.id) },
      },
    });
    expect(crossDeps).toBe(0);
  });

  it("re-import reuses the existing main activity and updates items by code", async () => {
    const result = await commitImport(
      [
        {
          name: "boundary WALL", // case-insensitive match
          items: [
            { code: "1.1", name: "Excavation (rev B)", category: "earthwork", boqQty: 95, unit: "CUM" },
            { code: "3.1", name: "Shuttering to wall", category: "shuttering", boqQty: 140, unit: "SQM" },
          ],
        },
      ],
      true,
    );
    expect(result.groupsCreated).toBe(0); // reused, not duplicated
    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);

    const groups = await testDb.activity.findMany({ where: { siteId, isGroup: true } });
    expect(groups.filter((g) => g.name.toLowerCase() === "boundary wall")).toHaveLength(1);

    const updated = await testDb.activity.findUnique({ where: { siteId_code: { siteId, code: "1.1" } } });
    expect(updated?.name).toBe("Excavation (rev B)");
    expect(Number(updated?.boqQty)).toBe(95);
  });

  it("groups carry no qty and are excluded from leaf-style queries", async () => {
    const leaves = await testDb.activity.findMany({ where: { siteId, isGroup: false } });
    const groups = await testDb.activity.findMany({ where: { siteId, isGroup: true } });
    expect(leaves.length).toBe(6);
    expect(groups.length).toBe(2);
    expect(leaves.every((l) => l.parentId !== null)).toBe(true);
  });
});
