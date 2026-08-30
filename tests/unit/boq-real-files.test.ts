import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseBoqWorkbook, type BoqCandidateRow } from "@/lib/boq-parser/parse";
import { classifyRow } from "@/lib/boq-parser/classify";

// Regression suite over REAL BOQ files supplied by the owner (five different
// architects/consultants, five different layouts). If a parser change breaks
// any of these expectations, it breaks a real file the app must handle.

const FIXTURES = path.join(__dirname, "..", "fixtures", "boq");

async function parse(file: string) {
  return parseBoqWorkbook(fs.readFileSync(path.join(FIXTURES, file)), { fileName: file });
}

function structuresOf(rows: Array<{ structure: string }>): string[] {
  return [...new Set(rows.map((r) => r.structure))];
}

function cat(r: BoqCandidateRow) {
  return classifyRow({ description: r.description, sectionPath: r.sectionPath, sheetName: r.sheetName });
}

describe("real BOQ: boundary wall (sections in the item-number column)", () => {
  it("parses all items with section context", async () => {
    const res = await parse("boundary-wall.xlsx");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(31);

    const first = res.rows[0];
    expect(first.itemNo).toBe("1.1.1");
    expect(first.qty).toBeCloseTo(4.464, 3);
    expect(first.unit).toBe("CUM");
    expect(first.sectionPath).toEqual(["EXCAVATION/SOIL-WORK"]);
    expect(cat(first)).toBe("earthwork");

    // Sub-totals parked in a dimension column must not become items.
    expect(res.rows.some((r) => /total/i.test(r.description))).toBe(false);
  });

  it("classifies shuttering children via the section (incl. 'Shuttring' typo)", async () => {
    const res = await parse("boundary-wall.xlsx");
    const child = res.rows.find((r) => r.description === "for Column footing PCC");
    expect(child).toBeDefined();
    expect(cat(child!)).toBe("shuttering");
  });
});

describe("real BOQ: retaining wall (multi design-variant sheets)", () => {
  it("parses every variant sheet and skips the survey sheet", async () => {
    const res = await parse("retaining-wall.xlsx");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(43);
    const parsedSheets = res.sheets.filter((s) => s.parsed).map((s) => s.name);
    expect(parsedSheets).toEqual([
      "BOQ_RW_as-Arch",
      "BOQ_RW_as-Our",
      "BOQ_RW_as-Tie_Beam",
      "Wall_Ded_With_RW",
    ]);
    expect(res.warnings.some((w) => w.includes('"Reduce_Level" skipped'))).toBe(true);
  });

  it("keeps duplicate item numbers across variant sheets distinct", async () => {
    const res = await parse("retaining-wall.xlsx");
    const first = res.rows.filter((r) => r.itemNo === "1.1.1");
    // 1.1.1 appears on every variant sheet — and TWICE on the Tie-Beam sheet.
    expect(first.length).toBe(5);
    expect(new Set(first.map((r) => r.sheetName)).size).toBe(4);
  });
});

describe("structure (main activity) detection across all five real files", () => {
  it("boundary wall: single structure from the workbook title row", async () => {
    const res = await parse("boundary-wall.xlsx");
    expect(structuresOf(res.rows)).toEqual(["Boundary Wall at Kanusi Site"]);
  });

  it("retaining wall: one structure per design-variant sheet, from sheet titles", async () => {
    const res = await parse("retaining-wall.xlsx");
    expect(structuresOf(res.rows)).toEqual([
      "Boundary Wall RW as Arch Design 11.4 Mtr",
      "Boundary Wall RW as Our Design 11.4 Mtr",
      "Boundary Wall as Column & Tie Beam Design 11.4 Mtr",
      "Deduction Amount Boundary Wall as RW Design 6.7 Mtr",
    ]);
  });

  it("pipe laying: structures from top-level item numbers (1.0.0 headings)", async () => {
    const res = await parse("pipe-laying.xlsx");
    const structures = structuresOf(res.rows);
    expect(structures).toContain("NP-2 Hume Pipe");
    expect(structures).toContain("DWC SN-8 Pipe");
    // "150 mm Dia" (1.1.0) stays a sub-section, never a structure.
    expect(structures.some((s) => /mm dia/i.test(s))).toBe(false);
  });

  it("water supply: BLOCK banners become sibling structures; service-line banners stay sections", async () => {
    const res = await parse("water-supply.xlsx");
    expect(structuresOf(res.rows)).toEqual(["BLOCK - A", "BLOCK - B"]);
    const b11 = res.rows.find((r) => r.itemNo === "B.1.1");
    expect(b11?.structure).toBe("BLOCK - B");
    expect(b11?.sectionPath.join(" ")).toContain("Fresh Water Main Lines");
  });
});

describe("real BOQ: pipe laying ('Item' desc header, 'Unit of Quantity')", () => {
  it("parses both pipe sheets, skips the empty one", async () => {
    const res = await parse("pipe-laying.xlsx");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(100);
    expect(res.warnings.some((w) => w.includes('"Kanausi" skipped'))).toBe(true);

    const laying = res.rows.find((r) => r.description === "Pipe Laying");
    expect(laying?.unit).toBe("MTR"); // "RM" normalized
    expect(cat(laying!)).toBe("external");

    const excv = res.rows.find((r) => r.description === "Excvation"); // typo in file
    expect(cat(excv!)).toBe("earthwork");

    const formwork = res.rows.find((r) => r.description === "PCC Formwork");
    expect(cat(formwork!)).toBe("shuttering");
  });
});

describe("real BOQ: water supply (count vs length quantity)", () => {
  it("uses the Length (Rm) column as quantity, not the pipe count", async () => {
    const res = await parse("water-supply.xlsx");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(27);
    expect(res.warnings.some((w) => w.includes("looks like a count"))).toBe(true);

    const a11 = res.rows.find((r) => r.itemNo === "A.1.1");
    expect(a11?.qty).toBeCloseTo(15.24, 2); // length, NOT the count of 1
    expect(a11?.unit).toBe("MTR");
    expect(a11?.sectionPath.join(" ")).toContain("Fresh Water Main Lines");
    expect(cat(a11!)).toBe("external");
  });

  it("merged banner rows become section headings, not items", async () => {
    const res = await parse("water-supply.xlsx");
    expect(res.rows.some((r) => /BLOCK - A/.test(r.description))).toBe(false);
    const blockB = res.rows.find((r) => r.itemNo === "B.1.1");
    expect(blockB?.sectionPath.join(" ")).toContain("Fresh Water Main Lines");
  });
});

describe("real BOQ: boundary wall 2-span (banner sections, BBS sheet)", () => {
  it("parses all three sheets including the bar bending schedule", async () => {
    const res = await parse("boundary-wall-2span.xlsx");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(61);
    const bbsRows = res.rows.filter((r) => r.sheetName === "BBS (2)");
    expect(bbsRows.length).toBeGreaterThan(0);
    // Everything on a BBS sheet is reinforcement work.
    for (const r of bbsRows) expect(cat(r)).toBe("reinforcement");
  });
});
