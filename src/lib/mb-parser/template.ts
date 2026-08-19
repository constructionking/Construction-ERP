import ExcelJS from "exceljs";

// Measurement Book template v1 — the preset format the app parses.
// Sheet "MB": header block rows 1-3, column headers row 5, data from row 6.

export const MB_SHEET = "MB";
export const HEADER_SITE_CODE_CELL = "B1";
export const HEADER_SHEET_NO_CELL = "B2";
export const HEADER_DATE_CELL = "B3";
export const COLUMN_HEADER_ROW = 5;
export const DATA_START_ROW = 6;

export const MB_COLUMNS = [
  { col: "A", header: "Sr No" },
  { col: "B", header: "Date (DD-MM-YYYY)" },
  { col: "C", header: "Activity Code" },
  { col: "D", header: "Description of Work" },
  { col: "E", header: "Location / Grid Ref" },
  { col: "F", header: "Nos" },
  { col: "G", header: "Length (m)" },
  { col: "H", header: "Breadth (m)" },
  { col: "I", header: "Depth/Height (m)" },
  { col: "J", header: "Qty" },
  { col: "K", header: "Unit" },
  { col: "L", header: "Executed By (DEPT or contractor name)" },
  { col: "M", header: "Remarks" },
] as const;

export async function buildMbTemplate(opts: {
  siteCode: string;
  activityCodes: Array<{ code: string; name: string; unit: string | null }>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(MB_SHEET);

  ws.getCell("A1").value = "Site Code";
  ws.getCell(HEADER_SITE_CODE_CELL).value = opts.siteCode;
  ws.getCell("A2").value = "MB Sheet No";
  ws.getCell(HEADER_SHEET_NO_CELL).value = "";
  ws.getCell("A3").value = "Date (DD-MM-YYYY)";
  ws.getCell(HEADER_DATE_CELL).value = "";
  for (const row of [1, 2, 3]) {
    ws.getCell(`A${row}`).font = { bold: true };
  }

  const headerRow = ws.getRow(COLUMN_HEADER_ROW);
  for (const { col, header } of MB_COLUMNS) {
    const cell = ws.getCell(`${col}${COLUMN_HEADER_ROW}`);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCECFD" } };
    cell.border = { bottom: { style: "thin" } };
  }
  headerRow.commit();

  ws.columns.forEach((c, i) => {
    c.width = [8, 14, 14, 34, 16, 8, 10, 10, 12, 12, 8, 22, 20][i] ?? 12;
  });

  const instructions = wb.addWorksheet("Instructions");
  instructions.getColumn(1).width = 100;
  const lines = [
    "MEASUREMENT BOOK — UPLOAD INSTRUCTIONS (template v1)",
    "",
    "1. One file per site per date. Fill Site Code, MB Sheet No and Date in the header block.",
    "2. Every data row must repeat the same date as the header (DD-MM-YYYY).",
    "3. Activity Code must be one of the codes listed below (set up by the owner).",
    "4. Nos, Length, Breadth, Depth are numbers in metres. Leave Breadth/Depth blank when not applicable.",
    "5. Qty must equal Nos × L × B × D (blank dims count as 1) within 1%. If you enter no dimensions, Qty is taken as-is.",
    "6. Unit must match the activity's unit: CUM, SQM, MTR, NOS or KG.",
    "7. Executed By: type DEPT for departmental labour, otherwise the contractor's name.",
    "8. Paste plain values, not formulas, wherever possible.",
    "9. The upload is all-or-nothing: any row error rejects the whole file with a row-wise error list.",
    "",
    "ACTIVITY CODES FOR THIS SITE:",
    ...opts.activityCodes.map((a) => `   ${a.code} — ${a.name}${a.unit ? ` (${a.unit})` : ""}`),
  ];
  lines.forEach((text, i) => {
    instructions.getCell(`A${i + 1}`).value = text;
    if (i === 0) instructions.getCell("A1").font = { bold: true, size: 13 };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
