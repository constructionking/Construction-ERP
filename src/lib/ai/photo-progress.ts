import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { raiseFlag } from "@/lib/audit/engine";
import { aiEnabled, getAiClient, extractJson, AI_MODEL } from "./client";

// AI photo-progress estimate: an independent second opinion stored BESIDE the
// engineer's figures, never overwriting them. Divergence raises a flag.

export const AI_DISCREPANCY_THRESHOLD_PP = 15; // percentage points

const estimateSchema = z.object({
  estimate_pct: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2000),
});

export function buildPhotoProgressPrompt(activity: {
  code: string;
  name: string;
  category: string;
  boqQty: string | null;
  unit: string | null;
}): string {
  return [
    `You are a construction site auditor. Estimate completion of ONE activity from site photos.`,
    ``,
    `Activity: ${activity.code} — ${activity.name}`,
    `Category: ${activity.category}`,
    activity.boqQty ? `Total scope (BOQ): ${activity.boqQty} ${activity.unit ?? ""}` : ``,
    ``,
    `Look only at evidence visible in the photos. Consider what stage the work appears to be at`,
    `relative to the full scope of this activity type (formwork/reinforcement/pour for concreting,`,
    `courses completed for masonry, coverage area for plaster/flooring, etc.).`,
    ``,
    `Reply with ONLY a JSON object:`,
    `{"estimate_pct": <0-100 number>, "confidence": <0-1 number>, "rationale": "<2-3 sentences citing visible evidence>"}`,
    ``,
    `If the photos do not show this activity clearly, use a low confidence (< 0.3).`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function mediaTypeOf(contentType: string): "image/jpeg" | "image/png" | "image/webp" | null {
  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp")
    return contentType;
  return null;
}

export async function runPhotoProgressEstimate(input: {
  siteId: string;
  activityId: string;
}): Promise<{ estimatePct: number } | null> {
  if (!aiEnabled()) return null;

  const activity = await prisma.activity.findUnique({ where: { id: input.activityId } });
  if (!activity) return null;

  const photos = await prisma.photo.findMany({
    where: {
      siteId: input.siteId,
      activityId: input.activityId,
      kind: "progress",
      supersededAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  if (photos.length === 0) return null;

  const storage = getStorage();
  const imageBlocks: Array<{
    type: "image";
    source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp"; data: string };
  }> = [];
  for (const photo of photos) {
    const file = await storage.get(photo.storageKey);
    if (!file) continue;
    const mediaType = mediaTypeOf(file.contentType);
    if (!mediaType) continue;
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: file.data.toString("base64") },
    });
  }
  if (imageBlocks.length === 0) return null;

  const prompt = buildPhotoProgressPrompt({
    code: activity.code,
    name: activity.name,
    category: activity.category,
    boqQty: activity.boqQty?.toString() ?? null,
    unit: activity.unit,
  });

  const response = await getAiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: prompt }],
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const parsed = estimateSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    console.error("[ai-photo-progress] unparseable response", text.slice(0, 300));
    return null;
  }
  const estimate = parsed.data;

  const record = await prisma.aiProgressEstimate.create({
    data: {
      siteId: input.siteId,
      activityId: input.activityId,
      photoIds: photos.map((p) => p.id),
      estimatePct: estimate.estimate_pct,
      model: AI_MODEL,
      rationale: estimate.rationale,
      confidence: estimate.confidence,
    },
  });

  // Compare with the engineer-derived percentage (Σ progress qty / BOQ qty).
  if (activity.boqQty && Number(activity.boqQty) > 0 && estimate.confidence >= 0.5) {
    const progress = await prisma.progressEntry.aggregate({
      where: { activityId: input.activityId, isCurrent: true, status: "submitted" },
      _sum: { qtyDone: true },
    });
    const engineerPct = Math.min(
      100,
      (Number(progress._sum.qtyDone ?? 0) / Number(activity.boqQty)) * 100
    );
    const gap = Math.abs(engineerPct - estimate.estimate_pct);
    if (gap > AI_DISCREPANCY_THRESHOLD_PP) {
      const flag = await raiseFlag({
        siteId: input.siteId,
        rule: "ai_progress_discrepancy",
        severity: gap > 30 ? "critical" : "warn",
        subjectType: "activity",
        subjectId: input.activityId,
        details: {
          activityCode: activity.code,
          engineerPct: Number(engineerPct.toFixed(1)),
          aiEstimatePct: estimate.estimate_pct,
          gapPp: Number(gap.toFixed(1)),
          confidence: estimate.confidence,
          rationale: estimate.rationale,
          estimateId: record.id,
        },
        title: `Photo evidence disagrees with reported progress on ${activity.code}`,
        body: `Engineer figures imply ${engineerPct.toFixed(0)}% done; photos suggest ~${estimate.estimate_pct.toFixed(0)}%. ${estimate.rationale}`,
      });
      await prisma.aiProgressEstimate.update({
        where: { id: record.id },
        data: { flagId: flag.id },
      });
    }
  }

  return { estimatePct: estimate.estimate_pct };
}
