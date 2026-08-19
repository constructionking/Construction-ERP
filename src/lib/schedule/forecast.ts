// Forecast completion from the actual progress run-rate vs the locked baseline.

export interface ForecastInput {
  plannedStart: string; // yyyy-mm-dd
  plannedEnd: string;
  plannedQty: number | null;
  /** current submitted progress entries for the activity */
  entries: Array<{ date: string; qty: number }>;
  todayIso: string;
}

export interface ForecastResult {
  forecastEnd: string;
  slipDays: number;
  /** slip as % of the planned (allotted) duration; ≤ 0 when on/ahead of time */
  slipPct: number;
  totalDone: number;
  status: "not_started" | "in_progress" | "complete";
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

export function computeForecast(input: ForecastInput): ForecastResult | null {
  const plannedQty = input.plannedQty ?? 0;
  if (plannedQty <= 0) return null;
  const plannedDuration = Math.max(1, daysBetween(input.plannedStart, input.plannedEnd) + 1);

  const entries = [...input.entries].sort((a, b) => a.date.localeCompare(b.date));
  const totalDone = entries.reduce((sum, e) => sum + e.qty, 0);

  let forecastEnd: string;
  let status: ForecastResult["status"];

  if (totalDone >= plannedQty) {
    forecastEnd = entries[entries.length - 1]?.date ?? input.todayIso;
    status = "complete";
  } else if (entries.length === 0) {
    status = "not_started";
    if (input.todayIso <= input.plannedStart) {
      forecastEnd = input.plannedEnd; // not due yet — assume plan holds
    } else {
      // Late start: the whole planned duration shifts by the days already lost.
      const startSlip = daysBetween(input.plannedStart, input.todayIso);
      forecastEnd = addDays(input.plannedEnd, startSlip);
    }
  } else {
    status = "in_progress";
    const actualStart = entries[0].date;
    const lastWorked = input.todayIso > actualStart ? input.todayIso : actualStart;
    const daysWorked = Math.max(1, daysBetween(actualStart, lastWorked) + 1);
    const rate = totalDone / daysWorked;
    const remaining = plannedQty - totalDone;
    const remainingDays = Math.ceil(remaining / rate);
    forecastEnd = addDays(input.todayIso, remainingDays);
  }

  const slipDays = daysBetween(input.plannedEnd, forecastEnd);
  const slipPct = (slipDays / plannedDuration) * 100;

  return {
    forecastEnd,
    slipDays,
    slipPct: Number(slipPct.toFixed(1)),
    totalDone,
    status,
  };
}
