import { describe, expect, it } from "vitest";
import { normalizeUnit, inferCategory, canonicalMaterialName } from "@/lib/inventory/demand";

describe("demand line → master unit", () => {
  it.each([
    ["bags", "BAG"],
    ["Bag", "BAG"],
    ["cft", "CFT"],
    ["cu ft", "CFT"],
    ["cubic feet", "CFT"],
    ["cum", "CUM"],
    ["m3", "CUM"],
    ["brass", "CUM"],
    ["kg", "KG"],
    ["kgs", "KG"],
    ["ton", "TON"],
    ["MT", "TON"],
    ["nos", "NOS"],
    ["pcs", "NOS"],
    ["litre", "LTR"],
    ["ltr", "LTR"],
    ["mtr", "MTR"],
    ["rmt", "MTR"],
    ["sqm", "SQM"],
    ["set", "SET"],
    ["days (hire)", "DAY"],
    ["days", "DAY"],
  ])("%s → %s", (text, unit) => {
    expect(normalizeUnit(text)).toBe(unit);
  });

  it("returns null for gibberish so the engineer is asked to pick", () => {
    expect(normalizeUnit("lorry")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
  });
});

describe("demand line → inventory category", () => {
  it.each([
    ["Cement OPC 43", "material", "cement"],
    ["Coarse sand", "material", "sand"],
    ["20 mm aggregate", "material", "aggregate"],
    ["TMT 12 mm", "material", "steel"],
    ["Binding wire", "material", "steel"],
    ["Fly ash bricks", "material", "brick"],
    ["Concrete mixer (hire)", "tool", "tool"],
    ["Vibrator needle", "tool", "tool"],
    ["Diesel", "other", "consumable"],
    ["Curing compound", "material", "consumable"],
    ["Safety helmets", "other", "consumable"],
    ["Bamboo", "tool", "tool"], // no keyword → falls back to the chip
    ["Tarpaulin", "other", "consumable"],
    ["Tarpaulin", "material", "other"],
  ])("%s (%s) → %s", (item, type, category) => {
    expect(inferCategory(item, type as "material" | "tool" | "other")).toBe(category);
  });
});

describe("canonical master name", () => {
  it("trims, collapses spaces and capitalises", () => {
    expect(canonicalMaterialName("  coarse   sand ")).toBe("Coarse sand");
  });
});
