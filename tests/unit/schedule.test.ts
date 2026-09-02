import { describe, it, expect } from "vitest";
import {
  suggestSchedule,
  topologicalOrder,
  walkDuration,
  type ScheduleActivityInput,
} from "@/lib/schedule/suggest";
import { DEFAULT_MONSOON_CONFIG, type MonsoonConfig } from "@/lib/schedule/monsoon";
import { computeForecast } from "@/lib/schedule/forecast";
import { evaluateContractorDelay } from "@/lib/audit/rules/contractor-delay";

const NO_MONSOON: MonsoonConfig = { ...DEFAULT_MONSOON_CONFIG, months: [] };

function act(
  id: string,
  overrides: Partial<ScheduleActivityInput> = {}
): ScheduleActivityInput {
  return { id, category: "general", boqQty: 100, normPerDay: 10, sequence: 0, ...overrides };
}

describe("duration walk", () => {
  it("plain duration = qty / norm outside monsoon", () => {
    const result = walkDuration("2026-01-01", act("a"), NO_MONSOON);
    expect(result.durationDays).toBe(10);
    expect(result.endIso).toBe("2026-01-10");
    expect(result.monsoonAffected).toBe(false);
  });

  it("monsoon derating stretches earthwork by 1/0.4", () => {
    // July is monsoon; earthwork multiplier 0.4 → 10 qty/day becomes 4/day
    const result = walkDuration(
      "2026-07-01",
      act("a", { category: "earthwork", boqQty: 40, normPerDay: 10 }),
      DEFAULT_MONSOON_CONFIG
    );
    expect(result.durationDays).toBe(10); // 40 / (10×0.4)
    expect(result.monsoonAffected).toBe(true);
  });

  it("work spanning into monsoon slows mid-way", () => {
    // Start late May (not monsoon), concreting 0.6 in June.
    // May 25-31: 7 days × 10 = 70. Remaining 30 at 6/day → 5 days.
    const result = walkDuration(
      "2026-05-25",
      act("a", { category: "concreting", boqQty: 100, normPerDay: 10 }),
      DEFAULT_MONSOON_CONFIG
    );
    expect(result.durationDays).toBe(12);
    expect(result.monsoonAffected).toBe(true);
  });

  it("activities without BOQ/norm get the default 7-day duration", () => {
    const result = walkDuration("2026-01-01", act("a", { boqQty: null, normPerDay: null }), NO_MONSOON);
    expect(result.durationDays).toBe(7);
  });
});

describe("topological ordering", () => {
  it("orders by dependencies then sequence", () => {
    const order = topologicalOrder(
      [act("c", { sequence: 3 }), act("a", { sequence: 1 }), act("b", { sequence: 2 })],
      [{ predecessorId: "c", successorId: "a", lagDays: 0 }]
    );
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c")); // seq 2 < 3, both ready
  });

  it("throws on cycles, naming members", () => {
    expect(() =>
      topologicalOrder(
        [act("a"), act("b")],
        [
          { predecessorId: "a", successorId: "b", lagDays: 0 },
          { predecessorId: "b", successorId: "a", lagDays: 0 },
        ]
      )
    ).toThrow(/cycle/i);
  });
});

describe("schedule suggestion", () => {
  it("chains FS dependencies with lag", () => {
    const dates = suggestSchedule({
      siteStartIso: "2026-01-01",
      activities: [
        act("fnd", { boqQty: 50, normPerDay: 10, sequence: 1 }),
        act("col", { boqQty: 30, normPerDay: 10, sequence: 2 }),
      ],
      dependencies: [{ predecessorId: "fnd", successorId: "col", lagDays: 2 }],
      config: NO_MONSOON,
    });
    const fnd = dates.find((d) => d.activityId === "fnd")!;
    const col = dates.find((d) => d.activityId === "col")!;
    expect(fnd.suggStart).toBe("2026-01-01");
    expect(fnd.suggEnd).toBe("2026-01-05");
    expect(col.suggStart).toBe("2026-01-08"); // end + 1 + 2 lag
    expect(col.suggEnd).toBe("2026-01-10");
  });

  it("independent activities all start at site start", () => {
    const dates = suggestSchedule({
      siteStartIso: "2026-02-01",
      activities: [act("a"), act("b")],
      dependencies: [],
      config: NO_MONSOON,
    });
    expect(dates.every((d) => d.suggStart === "2026-02-01")).toBe(true);
  });

  it("a main-activity anchor moves its items off the project start", () => {
    const dates = suggestSchedule({
      siteStartIso: "2026-02-01",
      activities: [
        act("ugt", { earliestStartIso: "2026-03-15" }),
        act("wall"), // no anchor → project start
      ],
      dependencies: [],
      config: NO_MONSOON,
    });
    expect(dates.find((d) => d.activityId === "ugt")!.suggStart).toBe("2026-03-15");
    expect(dates.find((d) => d.activityId === "wall")!.suggStart).toBe("2026-02-01");
  });

  it("dependencies push past an anchor, never before it", () => {
    const dates = suggestSchedule({
      siteStartIso: "2026-01-01",
      activities: [
        act("fnd", { boqQty: 50, normPerDay: 10, sequence: 1 }), // ends Jan 5
        // Anchored to Jan 2, but its predecessor only finishes Jan 5 → Jan 6.
        act("col", { earliestStartIso: "2026-01-02", sequence: 2 }),
        // Anchored AFTER the predecessor chain would allow → anchor wins.
        act("plinth", { earliestStartIso: "2026-02-01", sequence: 3 }),
      ],
      dependencies: [
        { predecessorId: "fnd", successorId: "col", lagDays: 0 },
        { predecessorId: "fnd", successorId: "plinth", lagDays: 0 },
      ],
      config: NO_MONSOON,
    });
    expect(dates.find((d) => d.activityId === "col")!.suggStart).toBe("2026-01-06");
    expect(dates.find((d) => d.activityId === "plinth")!.suggStart).toBe("2026-02-01");
  });
});

describe("forecast", () => {
  const base = {
    plannedStart: "2026-01-01",
    plannedEnd: "2026-01-20", // 20 planned days
    plannedQty: 100,
    todayIso: "2026-01-10",
  };

  it("on-track work forecasts on/before plan (no positive slip)", () => {
    // 10 days worked, 50 done → rate 5/day, 50 remaining → 10 more days
    const forecast = computeForecast({
      ...base,
      entries: [{ date: "2026-01-01", qty: 50 }],
    })!;
    expect(forecast.forecastEnd).toBe("2026-01-20");
    expect(forecast.slipPct).toBe(0);
    expect(forecast.status).toBe("in_progress");
  });

  it("slow run-rate produces proportional slip", () => {
    // 10 days worked, only 25 done → 2.5/day, 75 remaining → 30 days more
    const forecast = computeForecast({
      ...base,
      entries: [{ date: "2026-01-01", qty: 25 }],
    })!;
    expect(forecast.forecastEnd).toBe("2026-02-09");
    expect(forecast.slipDays).toBe(20);
    expect(forecast.slipPct).toBe(100);
  });

  it("not-started-and-overdue shifts the whole window", () => {
    const forecast = computeForecast({ ...base, entries: [], todayIso: "2026-01-06" })!;
    expect(forecast.status).toBe("not_started");
    expect(forecast.forecastEnd).toBe("2026-01-25"); // 5 days late start
    expect(forecast.slipDays).toBe(5);
    expect(forecast.slipPct).toBe(25);
  });

  it("not yet due → plan holds", () => {
    const forecast = computeForecast({ ...base, entries: [], todayIso: "2025-12-25" })!;
    expect(forecast.forecastEnd).toBe(base.plannedEnd);
    expect(forecast.slipPct).toBe(0);
  });

  it("completed work reports complete with the actual finish", () => {
    const forecast = computeForecast({
      ...base,
      entries: [
        { date: "2026-01-02", qty: 60 },
        { date: "2026-01-08", qty: 40 },
      ],
    })!;
    expect(forecast.status).toBe("complete");
    expect(forecast.forecastEnd).toBe("2026-01-08");
    expect(forecast.slipDays).toBeLessThan(0);
  });

  it("returns null without a planned quantity", () => {
    expect(computeForecast({ ...base, plannedQty: null, entries: [] })).toBeNull();
  });
});

describe("contractor delay rule", () => {
  it("flags only contractors past 10%, critical past 25%", () => {
    expect(evaluateContractorDelay({ slipPct: 8, contractorName: "Sharma" })).toBeNull();
    expect(evaluateContractorDelay({ slipPct: 10, contractorName: "Sharma" })).toBeNull();
    expect(evaluateContractorDelay({ slipPct: 15, contractorName: "Sharma" })!.severity).toBe(
      "warn"
    );
    expect(evaluateContractorDelay({ slipPct: 30, contractorName: "Sharma" })!.severity).toBe(
      "critical"
    );
    expect(evaluateContractorDelay({ slipPct: 50, contractorName: null })).toBeNull();
  });
});
