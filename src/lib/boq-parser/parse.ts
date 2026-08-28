import ExcelJS from "exceljs";
import type { Unit } from "@prisma/client";
import { cellScalar, asText } from "@/lib/mb-parser/parse";

// BOQ workbook parser for MESSY real-world files (every consultant formats
// differently). Strategy: detect the header row per sheet by scoring header
// keywords, map columns by header text + content sniffing, then extract line
// items. Nothing here touches the DB or network — pure and unit-testable.
// Columns that look like money (rate/amount) are EXCLUDED by design: this
// import carries quantities only.

export interface BoqCandidateRow {
  sheetName: string;
  rowNumber: number; // 1-based Excel row, for messages back to the owner
  itemNo: string | null;
  description: string;
  qty: number | null;
  qtyRaw: string | null;
  unit: Unit | null; // normalized; null when the sheet's unit is unmappable
  unitRaw: string | null;
  sectionPath: string[]; // enclosing section-heading texts, outermost first
}

export interface SheetReport {
  name: string;
  parsed: boolean;
  headerRow: number | null;
  score: number;
  rowCount: number;
}

export interface BoqParseResult {
  ok: boolean;
  rows: BoqCandidateRow[];
  sheets: SheetReport[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Unit normalization

export const UNIT_ALIASES: Record<string, Unit> = {
  cum: "CUM", "cu m": "CUM", "cu.m": "CUM", m3: "CUM", "m³": "CUM", cmt: "CUM",
  sqm: "SQM", "sq m": "SQM", "sq.m": "SQM", m2: "SQM", "m²": "SQM", smt: "SQM",
  m: "MTR", mtr: "MTR", rm: "MTR", rmt: "MTR", lm: "MTR", metre: "MTR",
  meter: "MTR", "r m": "MTR", "running metre": "MTR",
  no: "NOS", nos: "NOS", "no.": "NOS", "nos.": "NOS", each: "NOS", ea: "NOS",
  number: "NOS", numbers: "NOS",
  kg: "KG", kgs: "KG", "kg.": "KG",
  t: "TON", mt: "TON", ton: "TON", tonne: "TON", tonnes: "TON", tons: "TON",
  bag: "BAG", bags: "BAG",
};

// Vocabulary we RECOGNIZE as units but deliberately leave unmapped — the
// owner must choose on the review screen (e.g. quintal is a ×100 kg trap).
const KNOWN_UNMAPPED = new Set([
  "ls", "l.s", "l.s.", "lumpsum", "lump sum", "job", "quintal", "qtl", "%",
  "percent", "hour", "hr", "day", "ltr", "litre", "liter", "l",
]);

export function normalizeUnit(raw: string | null): Unit | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/[.\s]/g, "")] ?? null;
}

function looksLikeUnit(raw: string): boolean {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalizeUnit(raw) !== null || KNOWN_UNMAPPED.has(key) || KNOWN_UNMAPPED.has(key.replace(/\./g, ""))
  );
}

// ---------------------------------------------------------------------------
// Quantity coercion — real sheets hold "1,234.50", "125.5 cum", text numbers.

export function parseQtyValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  // Strip a trailing alpha token ("125.5 cum" → "125.5").
  s = s.replace(/[a-z°²³.]+\s*$/i, (m) => (/^[.\d]+$/.test(m) ? m : "")).trim();
  // Thousands separators (Indian and western grouping) and stray spaces.
  s = s.replace(/(?<=\d)[,\s](?=\d)/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Header detection & column mapping

const DESC_HEADER = /desc|particular|item of work|scope|nature of work/;
const QTY_HEADER = /^qty\.?$|quantity|^qnty/;
const UNIT_HEADER = /^unit$|^uom$|^units$/;
const ITEMNO_HEADER = /item\s*no|s\.?\s*no|sr\.?\s*no|sl\.?\s*no|^code$|^item$/;
// Word-bounded: "Particulars" ends in "rs" and must NOT read as money.
const MONEY_HEADER = /\brate\b|\bamount\b|\bcost\b|\bprice\b|\bvalue\b|\brs\.?(?![a-z])|₹|\binr\b/;

interface ColumnMap {
  itemNo: number | null;
  desc: number | null;
  qty: number | null;
  unit: number | null;
}

function rowTexts(ws: ExcelJS.Worksheet, r: number): Map<number, string> {
  const out = new Map<number, string>();
  const row = ws.getRow(r);
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = asText(cellScalar(cell));
    if (t) out.set(col, t);
  });
  return out;
}

function scoreHeaderRow(texts: Map<number, string>): { score: number; hasDesc: boolean; hasQty: boolean } {
  let score = 0;
  let hasDesc = false;
  let hasQty = false;
  for (const t of texts.values()) {
    const low = t.toLowerCase();
    if (DESC_HEADER.test(low)) { score += 2; hasDesc = true; }
    if (QTY_HEADER.test(low)) { score += 2; hasQty = true; }
    if (UNIT_HEADER.test(low)) score += 1;
    if (ITEMNO_HEADER.test(low)) score += 1;
  }
  return { score, hasDesc, hasQty };
}

const HEADER_SCAN_ROWS = 30;
const SNIFF_ROWS = 50;

function detectHeaderRow(ws: ExcelJS.Worksheet): { row: number; score: number } | null {
  let best: { row: number; score: number } | null = null;
  const limit = Math.min(HEADER_SCAN_ROWS, ws.rowCount);
  for (let r = 1; r <= limit; r++) {
    const { score, hasDesc, hasQty } = scoreHeaderRow(rowTexts(ws, r));
    if (score >= 4 && hasDesc && hasQty && (!best || score > best.score)) {
      best = { row: r, score };
    }
  }
  return best;
}

function mapColumns(ws: ExcelJS.Worksheet, headerRow: number, warnings: string[]): ColumnMap {
  const headers = rowTexts(ws, headerRow);
  const map: ColumnMap = { itemNo: null, desc: null, qty: null, unit: null };
  const excluded = new Set<number>();

  for (const [col, t] of headers) {
    const low = t.toLowerCase();
    if (MONEY_HEADER.test(low)) { excluded.add(col); continue; } // rates never ingested
    if (map.desc === null && DESC_HEADER.test(low)) { map.desc = col; continue; }
    if (map.qty === null && QTY_HEADER.test(low)) { map.qty = col; continue; }
    if (map.unit === null && UNIT_HEADER.test(low)) { map.unit = col; continue; }
    if (map.itemNo === null && ITEMNO_HEADER.test(low)) { map.itemNo = col; continue; }
  }

  // Content sniffing fills the gaps on sheets with odd/missing header names.
  const assigned = new Set([map.itemNo, map.desc, map.qty, map.unit].filter((c) => c !== null) as number[]);
  const stats = new Map<number, { numeric: number; unitHits: number; textLen: number; nonEmpty: number }>();
  const from = headerRow + 1;
  const to = Math.min(headerRow + SNIFF_ROWS, ws.rowCount);
  for (let r = from; r <= to; r++) {
    for (const [col, t] of rowTexts(ws, r)) {
      if (excluded.has(col) || assigned.has(col)) continue;
      const s = stats.get(col) ?? { numeric: 0, unitHits: 0, textLen: 0, nonEmpty: 0 };
      s.nonEmpty++;
      if (parseQtyValue(t) !== null) s.numeric++;
      if (looksLikeUnit(t)) s.unitHits++;
      s.textLen += t.length;
      stats.set(col, s);
    }
  }

  if (map.unit === null) {
    let best: number | null = null;
    let bestRatio = 0.3; // >30% of non-empty values must look like units
    for (const [col, s] of stats) {
      const ratio = s.nonEmpty ? s.unitHits / s.nonEmpty : 0;
      if (ratio > bestRatio) { best = col; bestRatio = ratio; }
    }
    if (best !== null) { map.unit = best; assigned.add(best); }
  }
  if (map.qty === null) {
    const numericCols = [...stats.entries()]
      .filter(([col, s]) => !assigned.has(col) && s.nonEmpty > 0 && s.numeric / s.nonEmpty > 0.5)
      .map(([col]) => col)
      .sort((a, b) => a - b);
    if (numericCols.length > 0) {
      // Indian BOQ column order is qty | rate | amount → prefer the LEFT one.
      map.qty = numericCols[0];
      assigned.add(numericCols[0]);
      if (numericCols.length > 1) {
        warnings.push(
          `Sheet "${ws.name}": several numeric columns; assumed the left-most is quantity — verify on the review screen`,
        );
      }
    }
  }
  if (map.desc === null) {
    let best: number | null = null;
    let bestAvg = 0;
    for (const [col, s] of stats) {
      if (assigned.has(col) || s.nonEmpty === 0) continue;
      const avg = s.textLen / s.nonEmpty;
      if (avg > bestAvg) { best = col; bestAvg = avg; }
    }
    if (best !== null && bestAvg >= 10) map.desc = best;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row extraction

const SUMMARY_ROW =
  /^\s*(sub[\s-]?total|total|grand total|carried (forward|over)|b\/f|c\/f|brought forward|page total|say\b)/i;

export async function parseBoqWorkbook(buffer: Buffer): Promise<BoqParseResult> {
  const warnings: string[] = [];
  const sheets: SheetReport[] = [];
  const rows: BoqCandidateRow[] = [];

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { ok: false, rows: [], sheets: [], warnings: ["File is not a readable .xlsx workbook"] };
  }

  for (const ws of wb.worksheets) {
    const header = detectHeaderRow(ws);
    if (!header) {
      sheets.push({ name: ws.name, parsed: false, headerRow: null, score: 0, rowCount: 0 });
      warnings.push(`Sheet "${ws.name}" skipped — no BOQ header row found`);
      continue;
    }
    const cols = mapColumns(ws, header.row, warnings);
    if (cols.desc === null || cols.qty === null) {
      sheets.push({ name: ws.name, parsed: false, headerRow: header.row, score: header.score, rowCount: 0 });
      warnings.push(`Sheet "${ws.name}" skipped — could not identify description and quantity columns`);
      continue;
    }

    let emitted = 0;
    let sectionPath: string[] = [];
    let prevDesc: string | null = null;

    for (let r = header.row + 1; r <= ws.rowCount; r++) {
      const texts = rowTexts(ws, r);
      if (texts.size === 0) continue;

      const desc = cols.desc !== null ? (texts.get(cols.desc) ?? null) : null;
      const qtyRaw = cols.qty !== null ? (texts.get(cols.qty) ?? null) : null;
      const unitRaw = cols.unit !== null ? (texts.get(cols.unit) ?? null) : null;
      const itemNo = cols.itemNo !== null ? (texts.get(cols.itemNo) ?? null) : null;

      if (!desc && qtyRaw === null && unitRaw === null) continue;
      if (desc && SUMMARY_ROW.test(desc)) continue;

      const qty = qtyRaw !== null ? parseQtyValue(qtyRaw) : null;

      // Merged description cells repeat the master's text on continuation
      // rows; a repeat with no qty of its own is not a new item.
      if (desc && desc === prevDesc && qty === null) continue;

      if (desc && qty === null && !unitRaw) {
        // Text-only row → section heading (single level is enough).
        sectionPath = [desc.trim()];
        continue;
      }
      if (!desc) {
        if (qty !== null) {
          warnings.push(`Sheet "${ws.name}" row ${r}: quantity without a description — skipped`);
        }
        continue;
      }
      if (qty === null) continue; // desc + unit but no usable qty: not a line item

      rows.push({
        sheetName: ws.name,
        rowNumber: r,
        itemNo: itemNo?.trim() || null,
        description: desc.trim(),
        qty,
        qtyRaw,
        unit: normalizeUnit(unitRaw),
        unitRaw,
        sectionPath: [...sectionPath],
      });
      prevDesc = desc;
      emitted++;
    }

    sheets.push({
      name: ws.name,
      parsed: true,
      headerRow: header.row,
      score: header.score,
      rowCount: emitted,
    });
  }

  return { ok: rows.length > 0, rows, sheets, warnings };
}
