// Pure steel + volume arithmetic for delivery telemetry. Unit-tested; no I/O.

/** Standard TMT/HYSD diameters (mm) sold in India. */
export const STEEL_DIAMETERS_MM = [8, 10, 12, 16, 20, 25, 32] as const;
/** Standard bar length (m) as supplied. */
export const STANDARD_BAR_LENGTH_M = 12;
/** 1 m³ = 35.3147 cubic feet — sites talk in "cft" for sand/aggregate. */
export const CFT_PER_CUM = 35.3147;
/** Estimate vs receipt gap beyond which the owner is flagged. */
export const RECEIPT_ESTIMATE_WARN_PCT = 15;
export const RECEIPT_ESTIMATE_CRITICAL_PCT = 30;

/** Unit weight of a round bar: d²/162 kg per metre (IS 1786 thumb rule). */
export function barWeightKgPerM(diameterMm: number): number {
  if (!(diameterMm > 0)) return 0;
  return (diameterMm * diameterMm) / 162.162;
}

export function steelWeightKg(input: { count: number; diameterMm: number; lengthM: number }): number {
  if (!(input.count > 0) || !(input.lengthM > 0)) return 0;
  return Number((input.count * input.lengthM * barWeightKgPerM(input.diameterMm)).toFixed(3));
}

/** Snap a measured diameter to the nearest standard size (bars are only sold in these). */
export function nearestStandardDiameter(diameterMm: number): number {
  return STEEL_DIAMETERS_MM.reduce((best, d) =>
    Math.abs(d - diameterMm) < Math.abs(best - diameterMm) ? d : best
  );
}

export function cumToCft(volumeCum: number): number {
  return Number((volumeCum * CFT_PER_CUM).toFixed(1));
}

/** Signed % gap of the engineer's receipt qty vs the estimate; null when no estimate. */
export function receiptEstimateGapPct(receiptQty: number, estimatedQty: number): number | null {
  if (!(estimatedQty > 0)) return null;
  return Number((((receiptQty - estimatedQty) / estimatedQty) * 100).toFixed(1));
}

export function receiptEstimateSeverity(gapPct: number | null): "warn" | "critical" | null {
  if (gapPct === null) return null;
  const abs = Math.abs(gapPct);
  if (abs > RECEIPT_ESTIMATE_CRITICAL_PCT) return "critical";
  if (abs > RECEIPT_ESTIMATE_WARN_PCT) return "warn";
  return null;
}
