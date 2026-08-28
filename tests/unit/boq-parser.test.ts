import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseBoqWorkbook, normalizeUnit, parseQtyValue } from "@/lib/boq-parser/parse";

// Synthetic MESSY workbooks — the parser must survive what consultants send.

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function sheetWithRows(wb: ExcelJS.Workbook, name: string, rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  for (const r of rows) ws.addRow(r);
  return ws;
}

describe("normalizeUnit", () => {
  const cases: Array<[string, string | null]> = [
    ["cum", "CUM"], ["Cu.M", "CUM"], ["m3", "CUM"], ["M³", "CUM"],
    ["sqm", "SQM"], ["m2", "SQM"], ["Sq M", "SQM"],
    ["rmt", "MTR"], ["RM", "MTR"], ["metre", "MTR"], ["m", "MTR"],
    ["mt", "TON"], // metric tonne — NEVER metre
    ["MT", "TON"], ["tonne", "TON"],
    ["nos", "NOS"], ["No.", "NOS"], ["each", "NOS"],
    ["kg", "KG"], ["Kgs", "KG"],
    ["bags", "BAG"],
    ["quintal", null], // ×100 kg trap — owner must decide
    ["LS", null], ["lumpsum", null], ["%", null], ["ltr", null],
    ["garbage-unit", null],
  ];
  it.each(cases)("%s → %s", (raw, expected) => {
    expect(normalizeUnit(raw)).toBe(expected);
  });
});

describe("parseQtyValue", () => {
  it("passes numbers and rejects non-positive", () => {
    expect(parseQtyValue(125.5)).toBe(125.5);
    expect(parseQtyValue(0)).toBeNull();
    expect(parseQtyValue(-3)).toBeNull();
  });
  it("handles text numbers with separators", () => {
    expect(parseQtyValue("1,234.50")).toBe(1234.5);
    expect(parseQtyValue(" 2 500 ")).toBe(2500);
  });
  it("strips a trailing unit token", () => {
    expect(parseQtyValue("125.5 cum")).toBe(125.5);
  });
  it("rejects text", () => {
    expect(parseQtyValue("as directed")).toBeNull();
  });
});

describe("parseBoqWorkbook", () => {
  it("parses a clean canonical sheet", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "BOQ", [
      ["Item No", "Description", "Unit", "Qty", "Rate", "Amount"],
      ["1.1", "Excavation in ordinary soil", "Cum", 450, 210, 94500],
      ["1.2", "PCC 1:4:8 in foundation", "Cum", 32, 5600, 179200],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ itemNo: "1.1", qty: 450, unit: "CUM" });
    // Rate/amount columns are ignored: qty is 450, not 210 or 94500.
    expect(res.rows[0].qty).toBe(450);
  });

  it("finds a header buried under title rows", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "Sheet1", [
      ["ABC CONSTRUCTIONS PVT LTD"],
      ["Project: Green Villa"],
      [],
      ["BILL OF QUANTITIES"],
      [],
      [],
      [],
      ["Sr. No", "Particulars of work", "Quantity", "Unit"],
      [1, "Brick masonry in CM 1:6", 320, "cum"],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.ok).toBe(true);
    expect(res.sheets[0].headerRow).toBe(8);
    expect(res.rows[0]).toMatchObject({ qty: 320, unit: "CUM" });
  });

  it("treats desc-only rows as section headings and skips totals", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "BOQ", [
      ["Item", "Description", "Qty", "Unit"],
      ["", "RCC WORKS", "", ""],
      ["2.1", "RCC M25 in columns", 85, "cum"],
      ["", "Total", 85, ""],
      ["", "Carried forward", "", ""],
      ["", "FINISHING WORKS", "", ""],
      ["5.1", "Internal plaster 12mm", 1800, "sqm"],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].sectionPath).toEqual(["RCC WORKS"]);
    expect(res.rows[1].sectionPath).toEqual(["FINISHING WORKS"]);
  });

  it("reads quantities stored as text", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "BOQ", [
      ["Description", "Qty", "Unit"],
      ["Reinforcement steel Fe500", "12,500", "kg"],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows[0].qty).toBe(12500);
    expect(res.rows[0].unit).toBe("KG");
  });

  it("keeps unmappable units as null with the raw text", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "BOQ", [
      ["Description", "Qty", "Unit"],
      ["Structural steel", 4, "quintal"],
      ["Excavation", 100, "cum"],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows[0].unit).toBeNull();
    expect(res.rows[0].unitRaw).toBe("quintal");
    expect(res.rows[1].unit).toBe("CUM");
  });

  it("resolves formula cells to their cached results", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");
    ws.addRow(["Description", "Qty", "Unit"]);
    ws.addRow(["Footing concrete", null, "cum"]);
    ws.getCell("B2").value = { formula: "10*22", result: 220 } as ExcelJS.CellFormulaValue;
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows[0].qty).toBe(220);
  });

  it("parses multiple trade sheets and reports skipped ones", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "Civil", [
      ["Description", "Qty", "Unit"],
      ["Excavation", 450, "cum"],
    ]);
    sheetWithRows(wb, "Finishes", [
      ["Description", "Qty", "Unit"],
      ["Painting two coats", 2600, "sqm"],
    ]);
    sheetWithRows(wb, "Summary", [["Grand summary"], ["Civil works", 950000]]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows).toHaveLength(2);
    expect(res.rows.map((r) => r.sheetName)).toEqual(["Civil", "Finishes"]);
    expect(res.warnings.some((w) => w.includes('"Summary" skipped'))).toBe(true);
  });

  it("skips merged-description continuation rows without their own qty", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");
    ws.addRow(["Description", "Qty", "Unit"]);
    ws.addRow(["Providing and laying RCC M25", 140, "cum"]);
    ws.addRow(["Providing and laying RCC M25", null, null]); // merge artifact
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows).toHaveLength(1);
  });

  it("fails cleanly on a garbage file", async () => {
    const res = await parseBoqWorkbook(Buffer.from("this is not a workbook"));
    expect(res.ok).toBe(false);
    expect(res.warnings[0]).toContain("not a readable");
  });

  it("warns and picks the LEFT numeric column when headers don't disambiguate", async () => {
    const wb = new ExcelJS.Workbook();
    sheetWithRows(wb, "BOQ", [
      ["Sr", "Description of work", "Quantity", "Unit", "Per", "Total"],
      [1, "Flooring with vitrified tiles", 900, "sqm", 145, 130500],
    ]);
    const res = await parseBoqWorkbook(await toBuffer(wb));
    expect(res.rows[0].qty).toBe(900);
  });
});
