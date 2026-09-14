import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { aiEnabled } from "@/lib/ai/client";
import { runSteelBarCount } from "@/lib/ai/steel-count";
import { volumeToQty } from "@/lib/scan/volume";
import { cumToCft, steelWeightKg, STANDARD_BAR_LENGTH_M } from "@/lib/telemetry/steel";

// Delivery estimate from the camera — stored beside the engineer's receipt
// (invariant: AI never overwrites human data). Three kinds:
//  steel_count  — AI counts bar ends in bundle-face photos → kg
//  manual_steel — engineer's own count × dia × length → kg (no AI needed)
//  scan_volume  — a computed heap scan → CUM/qty (+ cft for site language)
const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("steel_count"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    photoIds: z.array(z.string().uuid()).min(1).max(4),
    nominalDiaMm: z.number().min(4).max(50).nullable().default(null),
    lengthM: z.number().positive().max(24).default(STANDARD_BAR_LENGTH_M),
  }),
  z.object({
    kind: z.literal("manual_steel"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    photoIds: z.array(z.string().uuid()).max(4).default([]),
    count: z.number().int().positive().max(5000),
    diameterMm: z.number().min(4).max(50),
    lengthM: z.number().positive().max(24).default(STANDARD_BAR_LENGTH_M),
  }),
  z.object({
    kind: z.literal("scan_volume"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    scanId: z.string().uuid(),
  }),
]);

export const POST = withApi(async (req: NextRequest) => {
  const body = bodySchema.parse(await req.json());
  const ctx = await guard("receipt.create", { siteId: body.siteId });
  const material = await prisma.material.findUnique({ where: { id: body.materialId } });
  if (!material) throw new ApiError(400, "Unknown material");

  if (body.kind === "scan_volume") {
    const scan = await prisma.stockpileScan.findUnique({
      where: { id: body.scanId },
      include: { result: true },
    });
    if (!scan || scan.siteId !== body.siteId || !scan.result) {
      throw new ApiError(400, "Scan not found or not computed yet");
    }
    const volumeCum = Number(scan.result.computedVolumeCum ?? 0);
    const qty = volumeToQty(volumeCum, {
      unit: material.unit,
      densityKgPerCum: material.densityKgPerCum ? Number(material.densityKgPerCum) : null,
      unitsPerCum: material.unitsPerCum ? Number(material.unitsPerCum) : null,
    });
    if (qty === null) {
      throw new ApiError(400, `${material.name} has no volume conversion — ask the owner to set density/units per CUM`);
    }
    const estimate = await prisma.deliveryEstimate.create({
      data: {
        siteId: body.siteId,
        materialId: body.materialId,
        kind: "scan_volume",
        source: "scan",
        scanId: scan.id,
        estimatedQty: qty,
        unit: material.unit,
        confidence: scan.result.confidence,
        rationale: `Heap scan ${scan.method}: ${volumeCum.toFixed(3)} m³ (${cumToCft(volumeCum)} cft)`,
        createdById: ctx.userId,
      },
    });
    return NextResponse.json({
      available: true,
      estimate: { ...estimate, volumeCum, volumeCft: cumToCft(volumeCum) },
    });
  }

  if (material.unit !== "KG" && material.unit !== "TON") {
    throw new ApiError(400, `${material.name} is tracked in ${material.unit} — bar counting applies to steel in KG/TON`);
  }
  const toUnit = (kg: number) => (material.unit === "TON" ? Number((kg / 1000).toFixed(3)) : kg);

  if (body.kind === "manual_steel") {
    const kg = steelWeightKg({ count: body.count, diameterMm: body.diameterMm, lengthM: body.lengthM });
    const estimate = await prisma.deliveryEstimate.create({
      data: {
        siteId: body.siteId,
        materialId: body.materialId,
        kind: "steel_count",
        source: "manual",
        photoIds: body.photoIds,
        count: body.count,
        diameterMm: body.diameterMm,
        lengthM: body.lengthM,
        estimatedQty: toUnit(kg),
        unit: material.unit,
        rationale: `Engineer count: ${body.count} × Ø${body.diameterMm} mm × ${body.lengthM} m (d²/162)`,
        createdById: ctx.userId,
      },
    });
    return NextResponse.json({ available: true, estimate });
  }

  // steel_count (AI)
  if (!aiEnabled()) {
    return NextResponse.json({
      available: false,
      reason: "AI counting is not enabled on this server — count the bars and use the calculator below.",
    });
  }
  const result = await runSteelBarCount({ photoIds: body.photoIds, nominalDiaMm: body.nominalDiaMm });
  if (!result) {
    return NextResponse.json({ available: false, reason: "The AI could not read the photo — retake as a straight-on bundle-end shot." });
  }
  const diameterMm = body.nominalDiaMm ?? result.diameterMm;
  const kg = diameterMm && result.countable
    ? steelWeightKg({ count: result.count, diameterMm, lengthM: body.lengthM })
    : 0;
  const estimate = await prisma.deliveryEstimate.create({
    data: {
      siteId: body.siteId,
      materialId: body.materialId,
      kind: "steel_count",
      source: "ai",
      photoIds: body.photoIds,
      count: result.count,
      diameterMm: diameterMm ?? null,
      lengthM: body.lengthM,
      estimatedQty: toUnit(kg),
      unit: material.unit,
      confidence: result.confidence,
      rationale: result.rationale,
      model: result.model,
      createdById: ctx.userId,
    },
  });
  return NextResponse.json({
    available: true,
    estimate,
    ai: {
      countable: result.countable,
      aiDiameterMm: result.diameterMm,
      diameterMismatch:
        body.nominalDiaMm !== null && result.diameterMm !== null && result.diameterMm !== body.nominalDiaMm,
    },
  });
});
