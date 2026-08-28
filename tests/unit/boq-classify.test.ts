import { describe, it, expect } from "vitest";
import { classifyRow, assignCodes } from "@/lib/boq-parser/classify";
import { buildBoqClassifyPrompt, AI_CATEGORY_CONFIDENCE } from "@/lib/ai/boq-classify";

const row = (description: string, sectionPath: string[] = [], sheetName = "BOQ") => ({
  description,
  sectionPath,
  sheetName,
});

describe("classifyRow", () => {
  const cases: Array<[string, string]> = [
    ["Excavation in hard soil incl. shoring", "earthwork"],
    ["Sand filling under floors", "earthwork"],
    ["PCC 1:4:8 below footings", "concreting"],
    ["Providing and laying RCC M25 in raft", "concreting"],
    ["Reinforcement for RCC columns with Fe500 TMT bars", "reinforcement"],
    ["Bar bending and fixing in position", "reinforcement"],
    ["Shuttering to RCC slab including staging", "shuttering"],
    ["Formwork for columns", "shuttering"],
    ["Brick masonry in CM 1:6 in superstructure", "masonry"],
    ["AAC block work 200mm", "masonry"],
    ["12mm internal cement plaster", "plaster"],
    ["Waterproofing treatment to terrace with membrane", "waterproofing"],
    ["Vitrified tile flooring 600x600", "flooring"],
    ["Granite for kitchen platform", "flooring"],
    ["Two coats of plastic emulsion paint", "finishes"],
    ["Wall putty and primer", "finishes"],
    ["Compound wall with MS gate", "external"],
    ["Supplying misc items as directed", "general"],
  ];
  it.each(cases)("%s → %s", (desc, expected) => {
    expect(classifyRow(row(desc))).toBe(expected);
  });

  it("priority: reinforcement/shuttering win over concreting mentions", () => {
    expect(classifyRow(row("Reinforcement for RCC work"))).toBe("reinforcement");
    expect(classifyRow(row("Centering and shuttering for concrete"))).toBe("shuttering");
    expect(classifyRow(row("M25 RCC raft foundation"))).toBe("concreting");
  });

  it("falls back to section path, then sheet name", () => {
    expect(classifyRow(row("Item as per drawing", ["RCC WORKS"]))).toBe("concreting");
    expect(classifyRow(row("Item as per drawing", [], "Plaster & Finishes"))).toBe("plaster");
  });
});

describe("assignCodes", () => {
  it("keeps valid item numbers, uppercased", () => {
    const out = assignCodes(
      [{ itemNo: "1.2.3", category: "concreting" }, { itemNo: "a-4", category: "masonry" }],
      new Set(),
    );
    expect(out.map((o) => o.code)).toEqual(["1.2.3", "A-4"]);
    expect(out.every((o) => !o.duplicateInFile)).toBe(true);
  });

  it("generates prefixed codes when item numbers are missing or invalid", () => {
    const out = assignCodes(
      [
        { itemNo: null, category: "concreting" },
        { itemNo: "no code %", category: "concreting" },
        { itemNo: null, category: "reinforcement" },
      ],
      new Set(),
    );
    expect(out.map((o) => o.code)).toEqual(["CON-01", "CON-02", "REI-01"]);
  });

  it("generated codes never collide with existing site codes", () => {
    const out = assignCodes([{ itemNo: null, category: "concreting" }], new Set(["CON-01"]));
    expect(out[0].code).toBe("CON-02");
  });

  it("suffixes duplicate item numbers within one file and flags them", () => {
    const out = assignCodes(
      [{ itemNo: "5.1", category: "flooring" }, { itemNo: "5.1", category: "flooring" }],
      new Set(),
    );
    expect(out[0]).toEqual({ code: "5.1", duplicateInFile: false });
    expect(out[1].duplicateInFile).toBe(true);
    expect(out[1].code).not.toBe("5.1");
  });
});

describe("buildBoqClassifyPrompt", () => {
  it("lists every category and demands strict JSON", () => {
    const prompt = buildBoqClassifyPrompt({
      categories: ["earthwork", "concreting", "reinforcement", "shuttering", "masonry",
        "plaster", "waterproofing", "flooring", "finishes", "external", "general"],
      units: ["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"],
      rows: [
        { idx: 0, itemNo: "1.1", section: "RCC", description: "RCC M25", qtyRaw: "85", unitRaw: "cum" },
      ],
    });
    for (const c of ["reinforcement", "shuttering", "concreting", "general"]) {
      expect(prompt).toContain(c);
    }
    expect(prompt).toContain("Reply with ONLY JSON");
    expect(prompt).toContain("1.1");
  });

  it("merge threshold is between 0 and 1", () => {
    expect(AI_CATEGORY_CONFIDENCE).toBeGreaterThan(0);
    expect(AI_CATEGORY_CONFIDENCE).toBeLessThan(1);
  });
});
