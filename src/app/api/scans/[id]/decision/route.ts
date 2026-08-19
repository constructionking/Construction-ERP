import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { evaluateScanVariance } from "@/lib/audit/rules/scan-variance";
import { raiseFlag } from "@/lib/audit/engine";
import { variancePct } from "@/lib/scan/volume";

const bodySchema = z
  .object({
    decision: z.enum(["accepted", "rejected"]),
    engineerQty: z.number().positive().max(10_000_000).optional(),
  })
  .refine((v) => v.decision !== "rejected" || v.engineerQty !== undefined, {
    message: "Enter the actual quantity when rejecting the scan figure",
    path: ["engineerQty"],
  });

// The engineer's one-shot verdict on a computed scan. Immutable (DB trigger);
// a wrong decision is answered by a new scan. BOTH the computed figure and the
// engineer's figure — and their variance — are always reported to the owner.
export const POST = withApi(async (req: NextRequest, params) => {
  const scanId = z.string().uuid().parse(params.id);
  const body = bodySchema.parse(await req.json());

  const scan = await prisma.stockpileScan.findUnique({
    where: { id: scanId },
    include: { result: true, decision: true },
  });
  if (!scan) throw new ApiError(404, "Scan not found");
  const ctx = await guard("scan.decide", { siteId: scan.siteId });
  if (scan.status !== "computed") {
    throw new ApiError(409, `Scan is ${scan.status} — only computed scans can be decided`);
  }
  if (scan.decision) throw new ApiError(409, "This scan has already been decided");
  if (!scan.result?.computedQty) throw new ApiError(409, "Scan has no computed quantity");

  const computedQty = Number(scan.result.computedQty);
  const engineerQty = body.decision === "rejected" ? body.engineerQty! : null;
  const variance =
    engineerQty !== null ? variancePct(computedQty, engineerQty) : null;

  const decision = await prisma.$transaction(async (tx) => {
    const created = await tx.scanDecision.create({
      data: {
        scanId,
        decision: body.decision,
        engineerQty,
        variancePct: variance,
        decidedById: ctx.userId,
      },
    });
    await tx.stockpileScan.update({
      where: { id: scanId },
      data: { status: body.decision },
    });
    return created;
  });

  // Owner always sees scan-vs-engineer divergence.
  const material = await prisma.material.findUnique({ where: { id: scan.materialId } });
  const finding = evaluateScanVariance({ computedQty, engineerQty });
  if (finding) {
    await raiseFlag({
      siteId: scan.siteId,
      rule: "scan_variance",
      severity: finding.severity,
      subjectType: "stockpile_scan",
      subjectId: scanId,
      details: {
        materialId: scan.materialId,
        materialName: material?.name,
        method: scan.method,
        computedQty,
        engineerQty,
        variancePct: Number(finding.variancePct.toFixed(1)),
        unit: scan.result.qtyUnit,
        confidence: scan.result.confidence !== null ? Number(scan.result.confidence) : null,
      },
      title: `Scan rejected: ${finding.variancePct.toFixed(0)}% gap on ${material?.name ?? "material"}`,
      body: `Camera measured ${computedQty.toLocaleString("en-IN")} ${scan.result.qtyUnit}; engineer says ${engineerQty?.toLocaleString("en-IN")} ${scan.result.qtyUnit}`,
    });
  }

  return NextResponse.json({ decision }, { status: 201 });
});
