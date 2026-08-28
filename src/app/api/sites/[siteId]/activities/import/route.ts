import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { categoryEnum, unitEnum } from "@/lib/versioning/schemas";

// Commit of an owner-approved BOQ preview: bulk create/update activities in
// one transaction. Existing codes are UPDATED (name/category/qty/unit only —
// sequence, contractor, productivity norm and WBS parent are never touched);
// new codes are created after the site's current sequence tail, in file
// order. Optional chaining adds finish-start dependencies between the
// imported rows so the existing Gantt suggest → review → lock flow can build
// the schedule immediately.

const importSchema = z
  .object({
    chainSequence: z.boolean().default(false),
    items: z
      .array(
        z.object({
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
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const [i, item] of v.items.entries()) {
      const code = item.code.toUpperCase();
      if (seen.has(code)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate code ${code} in the import`,
          path: ["items", i, "code"],
        });
      }
      seen.add(code);
    }
  });

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const { chainSequence, items } = importSchema.parse(await req.json());

  const result = await prisma.$transaction(async (tx) => {
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
          data: { name: item.name, category: item.category, boqQty: item.boqQty, unit: item.unit },
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
      // Existing dependencies + the edges we add as we go: refuse any edge
      // that would close a cycle (the schedule walk must terminate).
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
          skipDuplicates: true, // idempotent re-import
        });
        if (res.count > 0) {
          dependenciesCreated++;
          addEdge(predecessorId, successorId);
        }
      }
    }

    return { created, updated: updatedCodes.length, updatedCodes, dependenciesCreated, skippedDeps };
  });

  return NextResponse.json(result, { status: 201 });
});
