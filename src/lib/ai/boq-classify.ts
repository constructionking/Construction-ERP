import { z } from "zod";
import { aiEnabled, getAiClient, extractJson, AI_MODEL } from "./client";
import { categoryEnum, unitEnum } from "@/lib/versioning/schemas";
import type { BoqCandidateRow } from "@/lib/boq-parser/parse";

// AI refinement of heuristically-parsed BOQ rows. Strictly a PRE-FILL: the
// result only seeds the owner's review screen, where every field stays
// editable — AI never creates or overwrites persisted data (app invariant).
// Without ANTHROPIC_API_KEY (or on any failure/timeout) this returns null and
// the keyword heuristics stand.

const responseSchema = z.object({
  rows: z
    .array(
      z.object({
        idx: z.number().int().nonnegative(),
        category: categoryEnum,
        name: z.string().min(1).max(200),
        unit: unitEnum.nullable(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(200),
});

export type BoqAiRow = z.infer<typeof responseSchema>["rows"][number];

// Merge threshold: AI category only replaces the heuristic when at least this
// confident. AI units are only used to FILL rows the heuristic left null.
export const AI_CATEGORY_CONFIDENCE = 0.6;

const CHUNK_SIZE = 150;
const TIMEOUT_MS = 20_000;
const DESC_TRUNCATE = 200;

export function buildBoqClassifyPrompt(input: {
  categories: string[];
  units: string[];
  rows: Array<{
    idx: number;
    itemNo: string | null;
    section: string;
    description: string;
    qtyRaw: string | null;
    unitRaw: string | null;
  }>;
}): string {
  return [
    `You are reading rows parsed from an Indian construction BOQ (bill of quantities) spreadsheet.`,
    ``,
    `Work categories (use EXACTLY one of these values): ${input.categories.join(", ")}`,
    `Units (use EXACTLY one of these values, or null when none fits): ${input.units.join(", ")}`,
    ``,
    `ROWS (idx | itemNo | section | description | qty | unit):`,
    ...input.rows.map(
      (r) =>
        `${r.idx} | ${r.itemNo ?? "-"} | ${r.section || "-"} | ${r.description} | ${r.qtyRaw ?? "-"} | ${r.unitRaw ?? "-"}`,
    ),
    ``,
    `For each row: classify the line into a work category, write a clean short work-item`,
    `name (max 200 chars, drop boilerplate like "including all leads and lifts"), and map`,
    `the unit to one of the listed values (m3=CUM, m2=SQM, rmt=MTR, MT=TON; lumpsum/%/hour`,
    `have no mapping -> null). confidence is 0..1 for the category choice.`,
    ``,
    `Reply with ONLY JSON: {"rows":[{"idx":<n>,"category":"...","name":"...","unit":"CUM"|null,"confidence":0.9}]}`,
  ].join("\n");
}

async function classifyChunk(rows: BoqCandidateRow[], startIdx: number): Promise<BoqAiRow[]> {
  const prompt = buildBoqClassifyPrompt({
    categories: categoryEnum.options,
    units: unitEnum.options,
    rows: rows.map((r, i) => ({
      idx: startIdx + i,
      itemNo: r.itemNo,
      section: r.sectionPath.join(" > "),
      description: r.description.slice(0, DESC_TRUNCATE),
      qtyRaw: r.qtyRaw,
      unitRaw: r.unitRaw,
    })),
  });

  const response = await getAiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = responseSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    console.error("[boq-classify] unparseable response", text.slice(0, 300));
    return [];
  }
  return parsed.data.rows;
}

/** Map of row index (position in the input array) → AI refinement. */
export async function refineBoqRows(rows: BoqCandidateRow[]): Promise<Map<number, BoqAiRow> | null> {
  if (!aiEnabled() || rows.length === 0) return null;
  try {
    const chunks: Promise<BoqAiRow[]>[] = [];
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      chunks.push(classifyChunk(rows.slice(i, i + CHUNK_SIZE), i));
    }
    const all = await Promise.race([
      Promise.all(chunks),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("boq-classify timeout")), TIMEOUT_MS),
      ),
    ]);
    const map = new Map<number, BoqAiRow>();
    for (const chunk of all) {
      for (const row of chunk) {
        if (row.idx < rows.length) map.set(row.idx, row);
      }
    }
    return map;
  } catch (err) {
    console.error("[boq-classify] failed — falling back to heuristics", err);
    return null;
  }
}
