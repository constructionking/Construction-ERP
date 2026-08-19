import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEnabled, getAiClient, extractJson, AI_MODEL } from "./client";

// Advisory review of a parsed measurement book: quantity outliers vs BOQ,
// dimension typos, duplicated lines. Never blocks, never edits — remarks are
// stored on the book and shown to the owner.

const remarkSchema = z.object({
  remarks: z
    .array(
      z.object({
        sr_no: z.number().int().nullable(),
        kind: z.enum(["qty_outlier", "dimension_suspect", "duplicate", "other"]),
        note: z.string().min(1).max(500),
      })
    )
    .max(20),
});

export type MbAiRemark = z.infer<typeof remarkSchema>["remarks"][number];

export function buildMbAnomalyPrompt(input: {
  lines: Array<{
    srNo: number;
    activityCode: string;
    description: string;
    nos: string;
    length: string | null;
    breadth: string | null;
    depth: string | null;
    qty: string;
    unit: string;
  }>;
  activities: Array<{ code: string; name: string; boqQty: string | null; unit: string | null; doneQty: string }>;
}): string {
  return [
    `You are auditing one day's measurement book from a construction site.`,
    ``,
    `ACTIVITY CONTEXT (code, name, total BOQ scope, quantity already recorded before today):`,
    ...input.activities.map(
      (a) => `${a.code} | ${a.name} | BOQ ${a.boqQty ?? "?"} ${a.unit ?? ""} | done ${a.doneQty}`
    ),
    ``,
    `TODAY'S MB LINES (srNo | activity | description | nos | L | B | D | qty | unit):`,
    ...input.lines.map(
      (l) =>
        `${l.srNo} | ${l.activityCode} | ${l.description} | ${l.nos} | ${l.length ?? "-"} | ${l.breadth ?? "-"} | ${l.depth ?? "-"} | ${l.qty} | ${l.unit}`
    ),
    ``,
    `Flag ONLY genuine concerns: (a) a line pushing cumulative qty past the activity's BOQ,`,
    `(b) a day's qty implausibly large for one day of that work, (c) suspect dimensions`,
    `(e.g. a 10 m deep footing), (d) near-duplicate lines that may be double entry.`,
    `Do not flag normal work. Empty list is a good answer.`,
    ``,
    `Reply with ONLY JSON: {"remarks": [{"sr_no": <line no or null>, "kind": "qty_outlier"|"dimension_suspect"|"duplicate"|"other", "note": "<short note>"}]}`,
  ].join("\n");
}

export async function runMbAnomalyReview(mbVersionRowId: string): Promise<number | null> {
  if (!aiEnabled()) return null;

  const book = await prisma.measurementBook.findUnique({
    where: { id: mbVersionRowId },
    include: { lines: { orderBy: { srNo: "asc" } } },
  });
  if (!book || book.lines.length === 0) return null;

  const codes = [...new Set(book.lines.map((l) => l.activityCode))];
  const activities = await prisma.activity.findMany({
    where: { siteId: book.siteId, code: { in: codes } },
  });
  const doneByActivity = await prisma.progressEntry.groupBy({
    by: ["activityId"],
    where: {
      siteId: book.siteId,
      isCurrent: true,
      status: "submitted",
      activityId: { in: activities.map((a) => a.id) },
    },
    _sum: { qtyDone: true },
  });
  const doneById = new Map(doneByActivity.map((d) => [d.activityId, d._sum.qtyDone]));

  const prompt = buildMbAnomalyPrompt({
    lines: book.lines.map((l) => ({
      srNo: l.srNo,
      activityCode: l.activityCode,
      description: l.description,
      nos: l.nos.toString(),
      length: l.length?.toString() ?? null,
      breadth: l.breadth?.toString() ?? null,
      depth: l.depth?.toString() ?? null,
      qty: l.qty.toString(),
      unit: l.unit,
    })),
    activities: activities.map((a) => ({
      code: a.code,
      name: a.name,
      boqQty: a.boqQty?.toString() ?? null,
      unit: a.unit,
      doneQty: doneById.get(a.id)?.toString() ?? "0",
    })),
  });

  const response = await getAiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const parsed = remarkSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    console.error("[mb-anomaly] unparseable response", text.slice(0, 300));
    return null;
  }

  await prisma.measurementBook.update({
    where: { id: mbVersionRowId },
    data: { aiRemarks: parsed.data.remarks as unknown as Prisma.InputJsonValue },
  });

  if (parsed.data.remarks.length > 0) {
    const owners = await prisma.user.findMany({ where: { isOwner: true, isActive: true } });
    const site = await prisma.site.findUnique({ where: { id: book.siteId } });
    await prisma.notification.createMany({
      data: owners.map((owner) => ({
        userId: owner.id,
        title: `MB review: ${parsed.data.remarks.length} advisory note(s) · ${site?.code ?? ""}`,
        body: parsed.data.remarks
          .slice(0, 3)
          .map((r) => `${r.sr_no ? `line ${r.sr_no}: ` : ""}${r.note}`)
          .join(" · "),
      })),
    });
  }

  return parsed.data.remarks.length;
}
