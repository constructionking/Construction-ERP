import ExcelJS from "exceljs";
import {
  MB_SHEET,
  HEADER_SITE_CODE_CELL,
  HEADER_SHEET_NO_CELL,
  HEADER_DATE_CELL,
  DATA_START_ROW,
} from "./template";

export interface MbRowError {
  row: number;
  column: string;
  message: string;
}

export interface ParsedMbLine {
  srNo: number;
  lineDate: string; // yyyy-mm-dd
  activityCode: string;
  description: string;
  location: string | null;
  nos: number;
  length: number | null;
  breadth: number | null;
  depth: number | null;
  qty: number;
  unit: string;
  executedBy: string;
  remarks: string | null;
}

export interface MbParseResult {
  ok: boolean;
  siteCode: string | null;
  sheetNo: string | null;
  mbDate: string | null; // yyyy-mm-dd
  lines: ParsedMbLine[];
  errors: MbRowError[];
}

export interface SiteActivityInfo {
  code: string;
  unit: string | null;
}

const VALID_UNITS = new Set(["CUM", "SQM", "MTR", "NOS", "KG", "BAG", "TON"]);
const QTY_TOLERANCE = 0.01; // 1%

/** Extract a scalar from a cell, resolving cached formula results. */
function cellScalar(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return v.result;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if (v instanceof Date) return v;
    if ("text" in v) return v.text; // hyperlink
    return null;
  }
  return v;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Accepts a Date cell or a DD-MM-YYYY string; returns yyyy-mm-dd. */
function asDdMmYyyy(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = asText(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // round-trip check rejects e.g. 31-02-2026
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * Parse + validate a measurement book upload against the site's activity list.
 * All rows are validated before returning — the caller rejects the whole file
 * when errors is non-empty (partial accept is not allowed by design).
 */
export async function parseMeasurementBook(
  fileBuffer: Buffer,
  site: { code: string; activities: SiteActivityInfo[] }
): Promise<MbParseResult> {
  const errors: MbRowError[] = [];
  const lines: ParsedMbLine[] = [];

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(fileBuffer as unknown as ArrayBuffer);
  } catch {
    return {
      ok: false,
      siteCode: null,
      sheetNo: null,
      mbDate: null,
      lines: [],
      errors: [{ row: 0, column: "-", message: "File is not a readable .xlsx workbook" }],
    };
  }

  const ws = wb.getWorksheet(MB_SHEET);
  if (!ws) {
    return {
      ok: false,
      siteCode: null,
      sheetNo: null,
      mbDate: null,
      lines: [],
      errors: [{ row: 0, column: "-", message: `Sheet "${MB_SHEET}" not found — use the provided template` }],
    };
  }

  const siteCode = asText(cellScalar(ws.getCell(HEADER_SITE_CODE_CELL)));
  const sheetNo = asText(cellScalar(ws.getCell(HEADER_SHEET_NO_CELL)));
  const mbDate = asDdMmYyyy(cellScalar(ws.getCell(HEADER_DATE_CELL)));

  if (!siteCode) errors.push({ row: 1, column: "B", message: "Site Code missing in header" });
  else if (siteCode.toUpperCase() !== site.code.toUpperCase()) {
    errors.push({
      row: 1,
      column: "B",
      message: `Site Code "${siteCode}" does not match this site (${site.code})`,
    });
  }
  if (!sheetNo) errors.push({ row: 2, column: "B", message: "MB Sheet No missing in header" });
  if (!mbDate) errors.push({ row: 3, column: "B", message: "Date missing or not DD-MM-YYYY" });

  const activityByCode = new Map(site.activities.map((a) => [a.code.toUpperCase(), a]));

  let expectedSr = 1;
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (col: string) => cellScalar(row.getCell(col));

    // A row with every meaningful column empty ends/skips silently.
    const isEmpty = ["A", "B", "C", "D", "F", "J", "K", "L"].every(
      (col) => asText(get(col)) === null
    );
    if (isEmpty) continue;

    const srNo = asNumber(get("A"));
    const lineDate = asDdMmYyyy(get("B"));
    const activityCode = asText(get("C"))?.toUpperCase() ?? null;
    const description = asText(get("D"));
    const location = asText(get("E"));
    const nos = asNumber(get("F"));
    const length = asNumber(get("G"));
    const breadth = asNumber(get("H"));
    const depth = asNumber(get("I"));
    const qty = asNumber(get("J"));
    const unit = asText(get("K"))?.toUpperCase() ?? null;
    const executedBy = asText(get("L"));
    const remarks = asText(get("M"));

    if (srNo === null || !Number.isInteger(srNo) || srNo < 1) {
      errors.push({ row: r, column: "A", message: "Sr No must be a positive integer" });
    } else if (srNo !== expectedSr) {
      errors.push({ row: r, column: "A", message: `Sr No out of sequence (expected ${expectedSr})` });
    }
    expectedSr += 1;

    if (!lineDate) {
      errors.push({ row: r, column: "B", message: "Date missing or not DD-MM-YYYY" });
    } else if (mbDate && lineDate !== mbDate) {
      errors.push({ row: r, column: "B", message: `Row date must equal header date (${mbDate})` });
    }

    let activity: SiteActivityInfo | undefined;
    if (!activityCode) {
      errors.push({ row: r, column: "C", message: "Activity Code missing" });
    } else {
      activity = activityByCode.get(activityCode);
      if (!activity) {
        errors.push({
          row: r,
          column: "C",
          message: `Unknown activity code "${activityCode}" for this site`,
        });
      }
    }

    if (!description) errors.push({ row: r, column: "D", message: "Description missing" });

    if (nos === null || nos < 0) {
      errors.push({ row: r, column: "F", message: "Nos must be a number ≥ 0" });
    }
    for (const [col, val, label] of [
      ["G", length, "Length"],
      ["H", breadth, "Breadth"],
      ["I", depth, "Depth/Height"],
    ] as const) {
      if (val !== null && val < 0) {
        errors.push({ row: r, column: col, message: `${label} cannot be negative` });
      }
    }

    if (qty === null || qty <= 0) {
      errors.push({ row: r, column: "J", message: "Qty must be a positive number" });
    }

    if (!unit) {
      errors.push({ row: r, column: "K", message: "Unit missing" });
    } else if (!VALID_UNITS.has(unit)) {
      errors.push({ row: r, column: "K", message: `Unit "${unit}" is not one of CUM/SQM/MTR/NOS/KG` });
    } else if (activity?.unit && unit !== activity.unit) {
      errors.push({
        row: r,
        column: "K",
        message: `Unit ${unit} does not match activity unit ${activity.unit}`,
      });
    }

    if (!executedBy) {
      errors.push({ row: r, column: "L", message: "Executed By missing (DEPT or contractor name)" });
    }

    // Dimension cross-check: when a length is given, Qty ≈ Nos × L × (B|1) × (D|1)
    if (nos !== null && length !== null && qty !== null && qty > 0) {
      const computed = nos * length * (breadth ?? 1) * (depth ?? 1);
      if (computed > 0) {
        const deviation = Math.abs(qty - computed) / computed;
        if (deviation > QTY_TOLERANCE) {
          errors.push({
            row: r,
            column: "J",
            message: `Qty ${qty} deviates ${(deviation * 100).toFixed(1)}% from Nos×L×B×D = ${computed.toFixed(3)}`,
          });
        }
      }
    }

    if (
      srNo !== null &&
      lineDate &&
      activityCode &&
      description &&
      nos !== null &&
      qty !== null &&
      qty > 0 &&
      unit &&
      executedBy
    ) {
      lines.push({
        srNo,
        lineDate,
        activityCode,
        description,
        location,
        nos,
        length,
        breadth,
        depth,
        qty,
        unit,
        executedBy,
        remarks,
      });
    }
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ row: DATA_START_ROW, column: "-", message: "No data rows found" });
  }

  return {
    ok: errors.length === 0,
    siteCode,
    sheetNo,
    mbDate,
    lines,
    errors,
  };
}
