// Pure departmental-labour cost math (unit-tested).

export interface LabourCostInput {
  entryType: "day_rate" | "period";
  rateBasis: "per_day" | "per_unit";
  workersCount: number;
  rate: number;
  outputQty: number | null;
  /** inclusive day count for period entries (computed by caller) */
  periodDays?: number;
}

/** Total cost of the entry. Open periods are costed up to "today". */
export function labourTotalCost(input: LabourCostInput): number {
  if (input.rateBasis === "per_unit") {
    return input.outputQty !== null ? input.rate * input.outputQty : 0;
  }
  const days = input.entryType === "day_rate" ? 1 : Math.max(1, input.periodDays ?? 1);
  return input.workersCount * input.rate * days;
}

export function labourCostPerUnit(input: LabourCostInput): number | null {
  if (input.outputQty === null || input.outputQty <= 0) return null;
  return labourTotalCost(input) / input.outputQty;
}

/** Inclusive day count between two yyyy-mm-dd dates. */
export function inclusiveDays(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}
