// Pure date maths for the day-scale schedule timeline. Business dates are
// `yyyy-mm-dd` strings handled in UTC so no local-timezone drift creeps in.

export const DAY_MS = 86_400_000;

export function dayIndex(iso: string, originIso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(originIso)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count of a [start, end] business-date range. */
export function spanDays(startIso: string, endIso: string): number {
  return dayIndex(endIso, startIso) + 1;
}

export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function fmtDayYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function snapDays(days: number, interval: number): number {
  const step = Math.max(1, Math.round(interval));
  return Math.round(days / step) * step;
}

export interface MonthSpan {
  startIso: string; // first of the month, may precede the range start
  endIso: string; // exclusive: first of next month, clamped to range end + 1
  label: string;
  monsoon: boolean;
}

/** Calendar months overlapping [startIso, endIso] (inclusive range). */
export function monthsInRange(
  startIso: string,
  endIso: string,
  monsoonMonths: number[],
): MonthSpan[] {
  const out: MonthSpan[] = [];
  const endExclusive = addDays(endIso, 1);
  const cursor = new Date(startIso);
  cursor.setUTCDate(1);
  while (cursor.toISOString().slice(0, 10) < endExclusive) {
    const monthStart = cursor.toISOString().slice(0, 10);
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextIso = next.toISOString().slice(0, 10);
    out.push({
      startIso: monthStart,
      endIso: nextIso > endExclusive ? endExclusive : nextIso,
      label: cursor.toLocaleDateString("en-IN", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      monsoon: monsoonMonths.includes(cursor.getUTCMonth() + 1),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** True when any day of [startIso, endIso] falls in a monsoon month. */
export function overlapsMonsoon(
  startIso: string,
  endIso: string,
  monsoonMonths: number[],
): boolean {
  return monthsInRange(startIso, endIso, monsoonMonths).some((m) => m.monsoon);
}

export type DragMode = "move" | "start" | "end";

/**
 * Where a bar lands after dragging `deltaDays`: move shifts both ends,
 * start/end handles stretch one edge and never cross the other (an activity
 * is at least one day long).
 */
export function previewRange(
  orig: { start: string; end: string },
  mode: DragMode,
  deltaDays: number,
): { start: string; end: string } {
  if (mode === "move") {
    return { start: addDays(orig.start, deltaDays), end: addDays(orig.end, deltaDays) };
  }
  if (mode === "start") {
    const start = addDays(orig.start, deltaDays);
    return { start: start > orig.end ? orig.end : start, end: orig.end };
  }
  const end = addDays(orig.end, deltaDays);
  return { start: orig.start, end: end < orig.start ? orig.start : end };
}

/** Chart range covering every [start, end] pair plus padding on both sides. */
export function chartRange(
  ranges: Array<{ start: string; end: string }>,
  padBefore: number,
  padAfter: number,
  include: string[] = [],
): { startIso: string; endIso: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const r of ranges) {
    if (!r.start || !r.end) continue;
    if (min === null || r.start < min) min = r.start;
    if (max === null || r.end > max) max = r.end;
  }
  if (min === null || max === null) return null;
  for (const iso of include) {
    if (iso > max) max = iso;
  }
  return { startIso: addDays(min, -padBefore), endIso: addDays(max, padAfter) };
}
