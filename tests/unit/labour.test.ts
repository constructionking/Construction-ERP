import { describe, it, expect } from "vitest";
import { labourTotalCost, labourCostPerUnit, inclusiveDays } from "@/lib/labour";
import { evaluateLabourCost } from "@/lib/audit/rules/labour-cost";

describe("labour cost math", () => {
  it("day-rate per-day: workers × rate for one day", () => {
    expect(
      labourTotalCost({
        entryType: "day_rate",
        rateBasis: "per_day",
        workersCount: 8,
        rate: 700,
        outputQty: 20,
      })
    ).toBe(5600);
  });

  it("period per-day: workers × rate × inclusive days", () => {
    expect(
      labourTotalCost({
        entryType: "period",
        rateBasis: "per_day",
        workersCount: 4,
        rate: 800,
        outputQty: 100,
        periodDays: 10,
      })
    ).toBe(32000);
  });

  it("per-unit basis: rate × output regardless of days", () => {
    expect(
      labourTotalCost({
        entryType: "period",
        rateBasis: "per_unit",
        workersCount: 4,
        rate: 45,
        outputQty: 300,
        periodDays: 12,
      })
    ).toBe(13500);
  });

  it("cost per unit and null guards", () => {
    expect(
      labourCostPerUnit({
        entryType: "day_rate",
        rateBasis: "per_day",
        workersCount: 8,
        rate: 700,
        outputQty: 20,
      })
    ).toBe(280);
    expect(
      labourCostPerUnit({
        entryType: "day_rate",
        rateBasis: "per_day",
        workersCount: 8,
        rate: 700,
        outputQty: null,
      })
    ).toBeNull();
    expect(
      labourCostPerUnit({
        entryType: "day_rate",
        rateBasis: "per_day",
        workersCount: 8,
        rate: 700,
        outputQty: 0,
      })
    ).toBeNull();
  });

  it("inclusive day counting", () => {
    expect(inclusiveDays("2026-08-01", "2026-08-01")).toBe(1);
    expect(inclusiveDays("2026-08-01", "2026-08-10")).toBe(10);
    expect(inclusiveDays("2026-08-10", "2026-08-01")).toBe(1); // degenerate → 1
  });
});

describe("labour benchmark rule", () => {
  const cases: Array<{
    name: string;
    cost: number;
    benchmark: number;
    expected: null | { severity: "warn" | "critical"; overrunPct: number };
  }> = [
    { name: "under benchmark → no flag", cost: 250, benchmark: 300, expected: null },
    { name: "exactly at benchmark → no flag", cost: 300, benchmark: 300, expected: null },
    { name: "10% over → warn", cost: 330, benchmark: 300, expected: { severity: "warn", overrunPct: 10 } },
    { name: "20% over → warn (boundary)", cost: 360, benchmark: 300, expected: { severity: "warn", overrunPct: 20 } },
    { name: "35% over → critical", cost: 405, benchmark: 300, expected: { severity: "critical", overrunPct: 35 } },
    { name: "no benchmark set → no flag", cost: 500, benchmark: 0, expected: null },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const finding = evaluateLabourCost({
        costPerUnit: c.cost,
        benchmarkCostPerUnit: c.benchmark,
      });
      if (c.expected === null) {
        expect(finding).toBeNull();
      } else {
        expect(finding).not.toBeNull();
        expect(finding!.severity).toBe(c.expected.severity);
        expect(finding!.overrunPct).toBeCloseTo(c.expected.overrunPct, 5);
      }
    });
  }
});
