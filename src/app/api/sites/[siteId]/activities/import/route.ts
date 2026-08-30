import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { categoryEnum, unitEnum } from "@/lib/versioning/schemas";

// Commit of an owner-approved BOQ preview, structured the way a civil
// engineer reads it: MAIN activities (structures — "Boundary wall", "STP")
// become isGroup parent rows; trade items become children via parentId.
// One transaction. Existing item codes are UPDATED (name/category/qty/unit/
// parent only — sequence, contractor, productivity norm are never touched);
// parents are matched by name case-insensitively so re-imports reuse them.
// Optional chaining adds finish-start dependencies WITHIN each structure so
// the existing Gantt suggest → review → lock flow can schedule immediately.

const itemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9._-]+$/i),
  name: z.string().trim().min(2).max(200),
  category: categoryEnum,
  boqQty: z.number().positive().max(100_000_000),
  unit: unitEnum, // the review screen blocks unmapped units
});

const importSchema = z
  .object({
    chainSequence: z.boolean().default(false),
    structures: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(200),
          items: z.array(itemSchema).min(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((v, ctx) => {
    const seenCodes = new Set<string>();
    const seenNames = new Set<string>();
    for (const [s, structure] of v.structures.entries()) {
      const nameKey = structure.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate main activity "${structure.name}"`,
          path: ["structures", s, "name"],
        });
      }
      seenNames.add(nameKey);
      for (const [i, item] of structure.items.entries()) {
        const code = item.code.toUpperCase();
        if (seenCodes.has(code)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate code ${code} in the import`,
            path: ["structures", s, "items", i, "code"],
          });
        }
        seenCodes.add(code);
      }
    }
    const total = v.structures.reduce((n, s) => n + s.items.length, 0);
    if (total > 500) {
      ctx.addIssue({ code: "custom", message: "At most 500 items per import", path: ["structures"] });
    }
  });

/** Group code from a structure name: "MA-BOUNDARY-WAL…" style, collision-safe. */
function groupCode(name: string, taken: Set<string>): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14);
  let code = `MA-${slug || "GROUP"}`.slice(0, 20);
  let n = 1;
  while (taken.has(code)) {
    n++;
    code = `MA-${slug.slice(0, 11)}-${n}`.slice(0, 20);
  }
  taken.add(code);
  return code;
}

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const { chainSequence, structures } = importSchema.parse(await req.json());

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.activity.findMany({
      where: { siteId },
      select: { id: true, code: true, name: true, sequence: true, isGroup: true },
    });
    const leafByCode = new Map(
      existing.filter((a) => !a.isGroup).map((a) => [a.code.toUpperCase(), a]),
    );
    const groupByName = new Map(
      existing.filter((a) => a.isGroup).map((a) => [a.name.trim().toLowerCase(), a]),
    );
    const takenCodes = new Set(existing.map((a) => a.code.toUpperCase()));
    let seq = existing.reduce((m, a) => Math.max(m, a.sequence), 0);

    // A leaf code colliding with a GROUP's code would silently corrupt the
    // tree — refuse with a clear message instead.
    for (const s of structures) {
      for (const item of s.items) {
        const code = item.code.toUpperCase();
        const clash = existing.find((a) => a.isGroup && a.code.toUpperCase() === code);
        if (clash) {
          throw new ApiError(409, `Code ${code} belongs to main activity "${clash.name}" — change it`);
        }
      }
    }

    let groupsCreated = 0;
    let created = 0;
    const updatedCodes: string[] = [];
    let dependenciesCreated = 0;
    let skippedDeps = 0;

    // Existing dependency graph for the cycle guard (shared across structures).
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
            category: "general",
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
              category: item.category,
              boqQty: item.boqQty,
              unit: item.unit,
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
              category: item.category,
              boqQty: item.boqQty,
              unit: item.unit,
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

      // Finish-start chain WITHIN this structure only.
      if (chainSequence && orderedIds.length > 1) {
        for (let i = 0; i + 1 < orderedIds.length; i++) {
          const predecessorId = orderedIds[i];
          const successorId = orderedIds[i + 1];
          if (predecessorId === successorId || reaches(successorId, predecessorId)) {
            skippedDeps++;
            continue;
          }
          const res = await tx.activityDependency.createMany({
            data: [{ predecessorId, successorId, lagDays: 0 }],
            skipDuplicates: true, // idempotent re-import
          });
          if (res.count > 0) {
            dependenciesCreated++;
            addEdge(predecessorId, successorId);
          }
        }
      }
    }

    return {
      groupsCreated,
      created,
      updated: updatedCodes.length,
      updatedCodes,
      dependenciesCreated,
      skippedDeps,
    };
  });

  return NextResponse.json(result, { status: 201 });
});
