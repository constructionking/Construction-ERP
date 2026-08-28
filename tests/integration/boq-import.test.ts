import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, resetDb, makeSite } from "../helpers/db";

// Exercises the BOQ commit semantics against the real database — including
// the widened ActivityCategory enum (reinforcement/shuttering), which proves
// the migration applied. The route's transaction logic is replicated via the
// same Prisma calls it makes; endpoint-level auth is covered by policy tests.

let siteId: string;

beforeAll(async () => {
  await resetDb();
  const site = await makeSite("BOQ");
  siteId = site.id;
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Mirrors the commit route's transaction body (kept in sync intentionally).
async function commitImport(
  items: Array<{ code: string; name: string; category: string; boqQty: number; unit: string }>,
  chainSequence: boolean,
) {
  return testDb.$transaction(async (tx) => {
    const existing = await tx.activity.findMany({
      where: { siteId },
      select: { id: true, code: true, sequence: true },
    });
    const byCode = new Map(existing.map((a) => [a.code.toUpperCase(), a]));
    let seq = existing.reduce((m, a) => Math.max(m, a.sequence), 0);

    const orderedIds: string[] = [];
    const updatedCodes: string[] = [];
    let created = 0;
    for (const item of items) {
      const code = item.code.toUpperCase();
      const prior = byCode.get(code);
      if (prior) {
        await tx.activity.update({
          where: { id: prior.id },
          data: {
            name: item.name,
            category: item.category as never,
            boqQty: item.boqQty,
            unit: item.unit as never,
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
            sequence: ++seq,
          },
        });
        orderedIds.push(row.id);
        created++;
      }
    }

    let dependenciesCreated = 0;
    let skippedDeps = 0;
    if (chainSequence && orderedIds.length > 1) {
      const edges = await tx.activityDependency.findMany({
        where: { successor: { siteId } },
        select: { predecessorId: true, successorId: true },
      });
      const adj = new Map<string, string[]>();
      const addEdge = (from: string, to: string) => {
        const list = adj.get(from) ?? [];
        list.push(to);
        adj.set(from, list);
      };
      for (const e of edges) addEdge(e.predecessorId, e.successorId);
      const reaches = (from: string, target: string): boolean => {
        const stack = [from];
        const seen = new Set<string>();
        while (stack.length) {
          const node = stack.pop()!;
          if (node === target) return true;
          if (seen.has(node)) continue;
          seen.add(node);
          for (const next of adj.get(node) ?? []) stack.push(next);
        }
        return false;
      };
      for (let i = 0; i + 1 < orderedIds.length; i++) {
        const predecessorId = orderedIds[i];
        const successorId = orderedIds[i + 1];
        if (predecessorId === successorId || reaches(successorId, predecessorId)) {
          skippedDeps++;
          continue;
        }
        const res = await tx.activityDependency.createMany({
          data: [{ predecessorId, successorId, lagDays: 0 }],
          skipDuplicates: true,
        });
        if (res.count > 0) {
          dependenciesCreated++;
          addEdge(predecessorId, successorId);
        }
      }
    }
    return { created, updated: updatedCodes.length, updatedCodes, dependenciesCreated, skippedDeps };
  });
}

describe("BOQ import commit semantics", () => {
  it("creates activities with the new enum values and chains dependencies", async () => {
    const result = await commitImport(
      [
        { code: "1.1", name: "Excavation in soil", category: "earthwork", boqQty: 450, unit: "CUM" },
        { code: "2.1", name: "RCC M25 columns", category: "concreting", boqQty: 85, unit: "CUM" },
        { code: "2.2", name: "Bar bending Fe500", category: "reinforcement", boqQty: 12500, unit: "KG" },
        { code: "2.3", name: "Shuttering to slab", category: "shuttering", boqQty: 1400, unit: "SQM" },
      ],
      true,
    );
    expect(result).toMatchObject({ created: 4, updated: 0, dependenciesCreated: 3, skippedDeps: 0 });

    const acts = await testDb.activity.findMany({ where: { siteId }, orderBy: { sequence: "asc" } });
    expect(acts.map((a) => a.code)).toEqual(["1.1", "2.1", "2.2", "2.3"]);
    expect(acts.map((a) => a.sequence)).toEqual([1, 2, 3, 4]);
    expect(acts[2].category).toBe("reinforcement"); // real PG enum value
    expect(acts[3].category).toBe("shuttering");
  });

  it("re-import updates by code without touching sequence/contractor, deps stay idempotent", async () => {
    // Give an existing row fields an update must NOT clobber.
    await testDb.activity.update({
      where: { siteId_code: { siteId, code: "2.1" } },
      data: { contractorName: "Sharma Constructions", productivityNormQtyPerDay: 6 },
    });

    const result = await commitImport(
      [
        { code: "2.1", name: "RCC M25 columns (rev B)", category: "concreting", boqQty: 92, unit: "CUM" },
        { code: "3.1", name: "Blockwork 200mm", category: "masonry", boqQty: 320, unit: "CUM" },
      ],
      true,
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.updatedCodes).toEqual(["2.1"]);

    const updated = await testDb.activity.findUnique({
      where: { siteId_code: { siteId, code: "2.1" } },
    });
    expect(updated?.name).toBe("RCC M25 columns (rev B)");
    expect(Number(updated?.boqQty)).toBe(92);
    expect(updated?.contractorName).toBe("Sharma Constructions"); // untouched
    expect(Number(updated?.productivityNormQtyPerDay)).toBe(6); // untouched
    expect(updated?.sequence).toBe(2); // untouched

    // New row sequences AFTER the existing tail.
    const created = await testDb.activity.findUnique({
      where: { siteId_code: { siteId, code: "3.1" } },
    });
    expect(created?.sequence).toBe(5);

    // Re-running the same import adds no duplicate dependencies.
    const again = await commitImport(
      [
        { code: "2.1", name: "RCC M25 columns (rev B)", category: "concreting", boqQty: 92, unit: "CUM" },
        { code: "3.1", name: "Blockwork 200mm", category: "masonry", boqQty: 320, unit: "CUM" },
      ],
      true,
    );
    expect(again.dependenciesCreated).toBe(0);
  });

  it("skips a chain edge that would close a dependency cycle", async () => {
    const a = await testDb.activity.findUniqueOrThrow({ where: { siteId_code: { siteId, code: "1.1" } } });
    const b = await testDb.activity.findUniqueOrThrow({ where: { siteId_code: { siteId, code: "2.1" } } });
    // Existing graph already has 1.1 -> 2.1. An import ordered [2.1, 1.1]
    // would try to add 2.1 -> 1.1, closing a loop — it must be skipped.
    const result = await commitImport(
      [
        { code: "2.1", name: "RCC M25 columns (rev B)", category: "concreting", boqQty: 92, unit: "CUM" },
        { code: "1.1", name: "Excavation in soil", category: "earthwork", boqQty: 450, unit: "CUM" },
      ],
      true,
    );
    expect(result.skippedDeps).toBe(1);
    expect(result.dependenciesCreated).toBe(0);

    const backEdge = await testDb.activityDependency.findFirst({
      where: { predecessorId: b.id, successorId: a.id },
    });
    expect(backEdge).toBeNull();
  });
});
