import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseMeasurementBook } from "@/lib/mb-parser/parse";

const SITE = {
  code: "SUN",
  activities: [
    { code: "FND", unit: "CUM" },
    { code: "COL", unit: "CUM" },
    { code: "MAS", unit: "SQM" },
  ],
};

interface RowSpec {
  sr?: unknown;
  date?: unknown;
  code?: unknown;
  desc?: unknown;
  loc?: unknown;
  nos?: unknown;
  l?: unknown;
  b?: unknown;
  d?: unknown;
  qty?: unknown;
  unit?: unknown;
  by?: unknown;
  remarks?: unknown;
}

async function buildFile(opts: {
  siteCode?: string;
  sheetNo?: string;
  date?: string;
  rows: RowSpec[];
  sheetName?: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? "MB");
  ws.getCell("A1").value = "Site Code";
  ws.getCell("B1").value = opts.siteCode ?? "SUN";
  ws.getCell("A2").value = "MB Sheet No";
  ws.getCell("B2").value = opts.sheetNo ?? "MB-001";
  ws.getCell("A3").value = "Date";
  ws.getCell("B3").value = opts.date ?? "19-08-2026";

  const cols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
  const keys: (keyof RowSpec)[] = [
    "sr", "date", "code", "desc", "loc", "nos", "l", "b", "d", "qty", "unit", "by", "remarks",
  ];
  opts.rows.forEach((row, i) => {
    keys.forEach((key, c) => {
      const v = row[key];
      if (v !== undefined) ws.getCell(`${cols[c]}${6 + i}`).value = v as ExcelJS.CellValue;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const GOOD_ROW: RowSpec = {
  sr: 1,
  date: "19-08-2026",
  code: "FND",
  desc: "Footing F1 to F6 PCC",
  loc: "Grid A1-A6",
  nos: 6,
  l: 2,
  b: 2,
  d: 0.5,
  qty: 12,
  unit: "CUM",
  by: "DEPT",
};

describe("measurement book parser", () => {
  it("parses a valid file", async () => {
    const buf = await buildFile({
      rows: [
        GOOD_ROW,
        {
          sr: 2,
          date: "19-08-2026",
          code: "MAS",
          desc: "Blockwork 2nd floor",
          nos: 1,
          l: 10,
          b: 3,
          qty: 30,
          unit: "SQM",
          by: "Sharma & Co",
        },
      ],
    });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.mbDate).toBe("2026-08-19");
    expect(result.sheetNo).toBe("MB-001");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      srNo: 1,
      activityCode: "FND",
      qty: 12,
      unit: "CUM",
      executedBy: "DEPT",
    });
  });

  it("rejects qty that deviates >1% from Nos×L×B×D", async () => {
    const buf = await buildFile({ rows: [{ ...GOOD_ROW, qty: 13 }] }); // true = 12
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.column === "J" && /deviates/.test(e.message))).toBe(true);
  });

  it("accepts qty within 1% tolerance", async () => {
    const buf = await buildFile({ rows: [{ ...GOOD_ROW, qty: 12.1 }] }); // 0.83%
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown activity codes", async () => {
    const buf = await buildFile({ rows: [{ ...GOOD_ROW, code: "XYZ" }] });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.errors.some((e) => e.column === "C" && /Unknown activity/.test(e.message))).toBe(
      true
    );
  });

  it("rejects unit mismatch against the activity's unit", async () => {
    const buf = await buildFile({ rows: [{ ...GOOD_ROW, unit: "SQM", qty: 12 }] });
    const result = await parseMeasurementBook(buf, SITE);
    expect(
      result.errors.some((e) => e.column === "K" && /does not match activity unit/.test(e.message))
    ).toBe(true);
  });

  it("rejects a row date different from the header date", async () => {
    const buf = await buildFile({ rows: [{ ...GOOD_ROW, date: "18-08-2026" }] });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.errors.some((e) => e.column === "B" && /header date/.test(e.message))).toBe(true);
  });

  it("rejects wrong site code, missing sheet no, and bad header date", async () => {
    const buf = await buildFile({ siteCode: "OTHER", sheetNo: "", date: "31-02-2026", rows: [GOOD_ROW] });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.errors.some((e) => e.row === 1 && /does not match this site/.test(e.message))).toBe(true);
    expect(result.errors.some((e) => e.row === 2)).toBe(true);
    expect(result.errors.some((e) => e.row === 3)).toBe(true);
  });

  it("rejects out-of-sequence Sr No and missing mandatory columns", async () => {
    const buf = await buildFile({
      rows: [GOOD_ROW, { ...GOOD_ROW, sr: 5, desc: undefined, by: undefined, date: "19-08-2026" }],
    });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.errors.some((e) => e.row === 7 && e.column === "A")).toBe(true);
    expect(result.errors.some((e) => e.row === 7 && e.column === "D")).toBe(true);
    expect(result.errors.some((e) => e.row === 7 && e.column === "L")).toBe(true);
  });

  it("resolves cached formula results instead of rejecting them", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MB");
    ws.getCell("B1").value = "SUN";
    ws.getCell("B2").value = "MB-002";
    ws.getCell("B3").value = "19-08-2026";
    ws.getCell("A6").value = 1;
    ws.getCell("B6").value = "19-08-2026";
    ws.getCell("C6").value = "FND";
    ws.getCell("D6").value = "PCC with formula qty";
    ws.getCell("F6").value = 6;
    ws.getCell("G6").value = 2;
    ws.getCell("H6").value = 2;
    ws.getCell("I6").value = 0.5;
    ws.getCell("J6").value = { formula: "F6*G6*H6*I6", result: 12 };
    ws.getCell("K6").value = "CUM";
    ws.getCell("L6").value = "DEPT";
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseMeasurementBook(buf, SITE);
    expect(result.ok).toBe(true);
    expect(result.lines[0].qty).toBe(12);
  });

  it("rejects files without the MB sheet and unreadable files", async () => {
    const wrongSheet = await buildFile({ rows: [GOOD_ROW], sheetName: "Sheet1" });
    const r1 = await parseMeasurementBook(wrongSheet, SITE);
    expect(r1.ok).toBe(false);
    expect(r1.errors[0].message).toMatch(/Sheet "MB" not found/);

    const r2 = await parseMeasurementBook(Buffer.from("not an xlsx"), SITE);
    expect(r2.ok).toBe(false);
    expect(r2.errors[0].message).toMatch(/not a readable/);
  });

  it("rejects an empty file with no data rows", async () => {
    const buf = await buildFile({ rows: [] });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /No data rows/.test(e.message))).toBe(true);
  });

  it("takes qty as-entered when no dimensions are given", async () => {
    const buf = await buildFile({
      rows: [
        {
          sr: 1,
          date: "19-08-2026",
          code: "COL",
          desc: "Column concreting C1-C4",
          nos: 4,
          qty: 7.2,
          unit: "CUM",
          by: "DEPT",
        },
      ],
    });
    const result = await parseMeasurementBook(buf, SITE);
    expect(result.ok).toBe(true);
    expect(result.lines[0].qty).toBe(7.2);
  });
});
