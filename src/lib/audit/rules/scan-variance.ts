// Pure rule: stockpile scan quantity vs book stock / engineer-entered actual.

export const SCAN_WARN_PCT = 10;
export const SCAN_CRITICAL_PCT = 25;

export interface ScanVarianceInput {
  /** qty computed by the scan pipeline */
  computedQty: number | null;
  /** engineer's figure when they rejected the scan (null when accepted) */
  engineerQty: number | null;
}

export interface ScanVarianceFinding {
  variancePct: number;
  severity: "warn" | "critical";
}

/**
 * Variance between what the camera measured and what the engineer says is
 * there. Large disagreement is itself the signal the owner wants to see —
 * whichever number is right, someone is mis-measuring or material is moving
 * off the books.
 */
export function evaluateScanVariance(input: ScanVarianceInput): ScanVarianceFinding | null {
  if (input.computedQty === null || input.engineerQty === null) return null;
  if (input.engineerQty <= 0) return null;
  const variancePct =
    (Math.abs(input.computedQty - input.engineerQty) / input.engineerQty) * 100;
  if (variancePct <= SCAN_WARN_PCT) return null;
  return {
    variancePct,
    severity: variancePct > SCAN_CRITICAL_PCT ? "critical" : "warn",
  };
}
