import { describe, it, expect } from "vitest";
import {
  addDays,
  chartRange,
  dayIndex,
  monthsInRange,
  overlapsMonsoon,
  previewRange,
  snapDays,
  spanDays,
  type DragMode,
} from "@/components/gantt/dates";

const MONSOON = [6, 7, 8, 9];

describe("day arithmetic", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2028-02-28", 1, "2028-02-29"], // leap year
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-12-31", 1, "2027-01-01"],
  ])("addDays(%s, %i) = %s", (iso, n, expected) => {
    expect(addDays(iso, n)).toBe(expected);
  });

  it("dayIndex and spanDays are inclusive-aware", () => {
    expect(dayIndex("2026-06-10", "2026-06-01")).toBe(9);
    expect(spanDays("2026-06-01", "2026-06-01")).toBe(1);
    expect(spanDays("2026-06-01", "2026-06-30")).toBe(30);
  });
});

describe("snapDays", () => {
  it.each([
    [0.4, 1, 0],
    [0.6, 1, 1],
    [-2.6, 1, -3],
    [3, 7, 0],
    [4, 7, 7],
    [-11, 7, -14],
  ])("snapDays(%d, %i) = %i", (days, interval, expected) => {
    expect(snapDays(days, interval)).toBe(expected);
  });
});

describe("previewRange (drag outcome)", () => {
  const orig = { start: "2026-06-10", end: "2026-06-20" };
  it.each<[DragMode, number, { start: string; end: string }]>([
    ["move", 5, { start: "2026-06-15", end: "2026-06-25" }],
    ["move", -10, { start: "2026-05-31", end: "2026-06-10" }],
    ["start", -3, { start: "2026-06-07", end: "2026-06-20" }],
    ["start", 4, { start: "2026-06-14", end: "2026-06-20" }],
    ["start", 30, { start: "2026-06-20", end: "2026-06-20" }], // never crosses the end
    ["end", 5, { start: "2026-06-10", end: "2026-06-25" }],
    ["end", -30, { start: "2026-06-10", end: "2026-06-10" }], // never crosses the start
  ])("%s by %i days", (mode, delta, expected) => {
    expect(previewRange(orig, mode, delta)).toEqual(expected);
  });

  it("a move keeps the duration", () => {
    const moved = previewRange(orig, "move", 37);
    expect(spanDays(moved.start, moved.end)).toBe(spanDays(orig.start, orig.end));
  });
});

describe("monthsInRange", () => {
  it("covers partial months at both ends and flags monsoon months", () => {
    const months = monthsInRange("2026-05-20", "2026-07-05", MONSOON);
    expect(months.map((m) => [m.startIso, m.endIso, m.monsoon])).toEqual([
      ["2026-05-01", "2026-06-01", false],
      ["2026-06-01", "2026-07-01", true],
      ["2026-07-01", "2026-07-06", true], // clamped to range end + 1
    ]);
  });

  it("crosses a year boundary", () => {
    const months = monthsInRange("2026-12-15", "2027-01-10", MONSOON);
    expect(months.map((m) => m.startIso)).toEqual(["2026-12-01", "2027-01-01"]);
  });
});

describe("overlapsMonsoon", () => {
  it.each([
    ["2026-01-01", "2026-05-31", false],
    ["2026-05-25", "2026-06-02", true],
    ["2026-09-30", "2026-10-15", true],
    ["2026-10-01", "2027-05-31", false],
  ])("%s → %s = %s", (start, end, expected) => {
    expect(overlapsMonsoon(start, end, MONSOON)).toBe(expected);
  });
});

describe("chartRange", () => {
  it("pads around the earliest start and latest end, extending for extra dates", () => {
    expect(
      chartRange(
        [
          { start: "2026-03-10", end: "2026-04-01" },
          { start: "2026-02-01", end: "2026-02-20" },
        ],
        3,
        7,
        ["2026-05-01"],
      ),
    ).toEqual({ startIso: "2026-01-29", endIso: "2026-05-08" });
  });

  it("ignores incomplete ranges and returns null when nothing is dated", () => {
    expect(chartRange([{ start: "", end: "" }], 3, 7)).toBeNull();
  });
});
