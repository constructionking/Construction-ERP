import { NextRequest, NextResponse } from "next/server";
import type { ActivityCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { parseBoqWorkbook } from "@/lib/boq-parser/parse";
import { classifyRow, assignCodes } from "@/lib/boq-parser/classify";
import { AI_CATEGORY_CONFIDENCE, refineBoqRows } from "@/lib/ai/boq-classify";

// BOQ Excel → parsed preview for the owner's review screen. Persists NOTHING:
// the review screen holds the rows client-side and commits the approved set
// through /api/sites/[siteId]/activities/import.

const MAX_BOQ_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500; // keeps the commit payload well under withApi's 1 MB cap

export interface BoqPreviewItem {
  code: string;
  name: string;
  category: ActivityCategory;
  qty: number | null;
  unit: Unit | null;
  unitRaw: string | null;
  sectionPath: string[];
  sheetName: string;
  rowNumber: number;
  exists: boolean; // code already on this site → commit will UPDATE it
  duplicateInFile: boolean;
  aiConfidence: number | null;
}

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Missing file");
  if (file.size > MAX_BOQ_BYTES) throw new ApiError(413, "File exceeds 10 MB");

  const buffer = Buffer.from(await file.arrayBuffer());
  const { isXlsxBytes } = await import("@/lib/uploads");
  if (!isXlsxBytes(buffer)) throw new ApiError(400, "File content is not a valid .xlsx workbook");

  const parsed = await parseBoqWorkbook(buffer);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "No BOQ line items could be read from this file",
        sheets: parsed.sheets,
        warnings: parsed.warnings,
      },
      { status: 422 },
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new ApiError(
      422,
      `This BOQ has ${parsed.rows.length} line items — split it into files of at most ${MAX_ROWS}`,
    );
  }

  const existing = await prisma.activity.findMany({ where: { siteId }, select: { code: true } });
  const existingCodes = new Set(existing.map((a) => a.code.toUpperCase()));

  // Heuristic classification first — the backbone (AI key may be absent).
  const categories = parsed.rows.map((r) =>
    classifyRow({ description: r.description, sectionPath: r.sectionPath, sheetName: r.sheetName }),
  );

  // Optional AI refinement: pre-fill only, merged under a confidence gate.
  const ai = await refineBoqRows(parsed.rows);

  const merged = parsed.rows.map((row, i) => {
    const aiRow = ai?.get(i);
    const category =
      aiRow && aiRow.confidence >= AI_CATEGORY_CONFIDENCE ? aiRow.category : categories[i];
    const unit = row.unit ?? aiRow?.unit ?? null; // AI fills only unmapped units
    const name = (aiRow?.name?.trim() || row.description).slice(0, 200);
    return { row, category, unit, name, aiConfidence: aiRow?.confidence ?? null };
  });

  const codes = assignCodes(
    merged.map((m) => ({ itemNo: m.row.itemNo, category: m.category })),
    existingCodes,
  );

  const items: BoqPreviewItem[] = merged.map((m, i) => ({
    code: codes[i].code,
    name: m.name,
    category: m.category,
    qty: m.row.qty,
    unit: m.unit,
    unitRaw: m.row.unitRaw,
    sectionPath: m.row.sectionPath,
    sheetName: m.row.sheetName,
    rowNumber: m.row.rowNumber,
    exists: existingCodes.has(codes[i].code.toUpperCase()),
    duplicateInFile: codes[i].duplicateInFile,
    aiConfidence: m.aiConfidence,
  }));

  return NextResponse.json({
    items,
    sheets: parsed.sheets,
    warnings: parsed.warnings,
    aiUsed: ai !== null,
  });
});
