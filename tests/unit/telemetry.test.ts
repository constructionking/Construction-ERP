import { describe, expect, it } from "vitest";
import {
  barWeightKgPerM,
  steelWeightKg,
  nearestStandardDiameter,
  cumToCft,
  receiptEstimateGapPct,
  receiptEstimateSeverity,
} from "@/lib/telemetry/steel";
import { buildSteelCountPrompt } from "@/lib/ai/steel-count";

describe("steel delivery arithmetic", () => {
  it("uses the d²/162 unit weight (IS 1786 thumb rule)", () => {
    expect(barWeightKgPerM(12)).toBeCloseTo(0.888, 2);
    expect(barWeightKgPerM(16)).toBeCloseTo(1.579, 2);
    expect(barWeightKgPerM(0)).toBe(0);
  });

  it("weighs a delivery: count × length × kg/m", () => {
    // 84 bars of Ø12 × 12 m ≈ 895 kg
    expect(steelWeightKg({ count: 84, diameterMm: 12, lengthM: 12 })).toBeCloseTo(895.2, 0);
    expect(steelWeightKg({ count: 0, diameterMm: 12, lengthM: 12 })).toBe(0);
  });

  it("snaps a measured diameter to a size bars are actually sold in", () => {
    expect(nearestStandardDiameter(11.4)).toBe(12);
    expect(nearestStandardDiameter(17)).toBe(16);
    expect(nearestStandardDiameter(30)).toBe(32);
  });

  it("converts heap volume to cft for site language", () => {
    expect(cumToCft(1)).toBeCloseTo(35.3, 1);
    expect(cumToCft(12.4)).toBeCloseTo(437.9, 1);
  });

  it.each([
    [100, 100, 0, null],
    [110, 100, 10, null],
    [120, 100, 20, "warn"],
    [90, 100, -10, null],
    [70, 100, -30, "warn"],
    [65, 100, -35, "critical"],
    [140, 100, 40, "critical"],
  ])("receipt %s vs estimate %s → gap %s%% severity %s", (receipt, estimate, gap, severity) => {
    const pct = receiptEstimateGapPct(receipt, estimate);
    expect(pct).toBe(gap);
    expect(receiptEstimateSeverity(pct)).toBe(severity);
  });

  it("has no gap without an estimate", () => {
    expect(receiptEstimateGapPct(100, 0)).toBeNull();
    expect(receiptEstimateSeverity(null)).toBeNull();
  });
});

describe("steel count prompt", () => {
  it("tells the model the challan diameter when known and asks for reshoot guidance", () => {
    const p = buildSteelCountPrompt(12);
    expect(p).toContain("12 mm");
    expect(p).toContain("countable=false");
    expect(p).toContain('"count"');
  });
  it("lists standard sizes when the diameter is unknown", () => {
    expect(buildSteelCountPrompt(null)).toContain("8, 10, 12, 16, 20, 25, 32 mm");
  });
});
