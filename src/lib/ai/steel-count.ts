import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { aiEnabled, getAiClient, extractJson, AI_MODEL } from "./client";
import { nearestStandardDiameter, STEEL_DIAMETERS_MM } from "@/lib/telemetry/steel";

// AI steel-bar count from a bundle-END photo: counts bar cross-sections and
// estimates the diameter from a reference in frame. A second opinion stored
// beside the engineer's receipt — never a replacement for it.

const resultSchema = z.object({
  count: z.number().int().min(0).max(5000),
  diameter_mm: z.number().min(4).max(50).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2000),
  countable: z.boolean(),
});

export interface SteelCountResult {
  count: number;
  diameterMm: number | null;
  confidence: number;
  rationale: string;
  countable: boolean;
  model: string;
}

export function buildSteelCountPrompt(nominalDiaMm: number | null): string {
  return [
    `You are counting reinforcement steel (TMT bars) delivered to an Indian construction site.`,
    `The photo shows the END FACE of one or more bar bundles: each bar appears as a small circle`,
    `(its cross-section). Count EVERY visible bar end once, including bars partly hidden behind others`,
    `if their circle is discernible. Do not count bars twice across bundles.`,
    ``,
    nominalDiaMm
      ? `The engineer states the challan diameter is ${nominalDiaMm} mm. Use it as the expected size; report diameter_mm as your own estimate from the image (a reference object such as a coin, tape or ruler may be in frame).`
      : `Estimate the bar diameter in mm from a reference object in frame (coin, tape, ruler) if present; otherwise null. Bars are sold only in these sizes: ${STEEL_DIAMETERS_MM.join(", ")} mm.`,
    ``,
    `If the photo is not a clear end-face view (bars seen lengthwise, blurred, too dark, ends not visible),`,
    `set countable=false, count=0 and explain what to reshoot.`,
    ``,
    `Reply with ONLY a JSON object:`,
    `{"count": <integer>, "diameter_mm": <number or null>, "confidence": <0-1>, "countable": <true|false>, "rationale": "<2-3 sentences: bundles seen, how you counted, any occlusion>"}`,
  ].join("\n");
}

function mediaTypeOf(contentType: string): "image/jpeg" | "image/png" | "image/webp" | null {
  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp")
    return contentType;
  return null;
}

export async function runSteelBarCount(input: {
  photoIds: string[];
  nominalDiaMm: number | null;
}): Promise<SteelCountResult | null> {
  if (!aiEnabled()) return null;

  const photos = await prisma.photo.findMany({ where: { id: { in: input.photoIds } } });
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

  const response = await getAiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: buildSteelCountPrompt(input.nominalDiaMm) }],
      },
    ],
  });
  const text = response.content
    .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
    .join("\n");
  const parsed = resultSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    console.error("steel count: unparseable AI response", text.slice(0, 300));
    return null;
  }
  const r = parsed.data;
  return {
    count: r.count,
    diameterMm: r.diameter_mm !== null ? nearestStandardDiameter(r.diameter_mm) : null,
    confidence: r.confidence,
    rationale: r.rationale,
    countable: r.countable,
    model: AI_MODEL,
  };
}
