import { describe, it, expect } from "vitest";
import { templateVolumeCum, volumeToQty, variancePct } from "@/lib/scan/volume";

describe("template volume formulas", () => {
  it("cone: (π/12)·D²·h", () => {
    // D=4, h=1.5 → π/12·16·1.5 = 2π ≈ 6.2832
    expect(templateVolumeCum("cone", { length: 4, height: 1.5 })).toBeCloseTo(6.2832, 3);
  });

  it("rect stack: exact prism", () => {
    expect(templateVolumeCum("rect_stack", { length: 3, width: 2, height: 1.2 })).toBeCloseTo(
      7.2,
      6
    );
  });

  it("windrow: half prism", () => {
    expect(templateVolumeCum("windrow", { length: 10, width: 3, height: 1.5 })).toBeCloseTo(
      22.5,
      6
    );
  });

  it("guards zero/missing dimensions", () => {
    expect(templateVolumeCum("cone", { length: 0, height: 2 })).toBe(0);
    expect(templateVolumeCum("rect_stack", { length: 3, height: 1 })).toBe(0);
    expect(templateVolumeCum("windrow", { length: 3, width: 0, height: 1 })).toBe(0);
  });
});

describe("volume → stock unit conversion", () => {
  it("CUM passes through", () => {
    expect(volumeToQty(12.5, { unit: "CUM", densityKgPerCum: null, unitsPerCum: null })).toBe(12.5);
  });

  it("bricks by units per CUM", () => {
    expect(volumeToQty(2, { unit: "NOS", densityKgPerCum: null, unitsPerCum: 500 })).toBe(1000);
  });

  it("steel by density to TON", () => {
    expect(volumeToQty(0.5, { unit: "TON", densityKgPerCum: 7850, unitsPerCum: null })).toBeCloseTo(
      3.925,
      6
    );
  });

  it("returns null without a conversion factor or for non-volumetric units", () => {
    expect(volumeToQty(2, { unit: "NOS", densityKgPerCum: null, unitsPerCum: null })).toBeNull();
    expect(volumeToQty(2, { unit: "SQM", densityKgPerCum: 1000, unitsPerCum: 10 })).toBeNull();
  });
});

describe("variance", () => {
  it("signed percentage against the engineer figure", () => {
    expect(variancePct(110, 100)).toBe(10);
    expect(variancePct(90, 100)).toBe(-10);
    expect(variancePct(100, 0)).toBeNull();
  });
});
