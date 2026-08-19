// Pure rule: actual material consumption vs theoretical from the mix design.
// theoretical = coefficient (qty per CUM) × total progress qty on the activity.

export interface ConsumptionVarianceInput {
  /** Total progress qty (in the mix's output unit, normally CUM) on the activity */
  progressQty: number;
  /** Mix coefficients: material → qty per output unit */
  coefficients: Array<{ materialId: string; qtyPerUnit: number }>;
  /** Actual consumption per material on the activity */
  actualByMaterial: Array<{ materialId: string; qty: number }>;
}

export interface ConsumptionVarianceFinding {
  materialId: string;
  theoretical: number;
  actual: number;
  variancePct: number;
  severity: "warn" | "critical";
}

export const CONSUMPTION_WARN_PCT = 10;
export const CONSUMPTION_CRITICAL_PCT = 25;

export function evaluateConsumptionVariance(
  input: ConsumptionVarianceInput
): ConsumptionVarianceFinding[] {
  const findings: ConsumptionVarianceFinding[] = [];
  if (input.progressQty <= 0) return findings;

  const actualBy = new Map(input.actualByMaterial.map((a) => [a.materialId, a.qty]));

  for (const coefficient of input.coefficients) {
    const theoretical = coefficient.qtyPerUnit * input.progressQty;
    if (theoretical <= 0) continue;
    const actual = actualBy.get(coefficient.materialId) ?? 0;
    // Over-consumption is the audit target (leakage/theft/waste); genuine
    // under-consumption usually means work recorded ahead of material entry.
    const variancePct = ((actual - theoretical) / theoretical) * 100;
    if (variancePct > CONSUMPTION_CRITICAL_PCT) {
      findings.push({
        materialId: coefficient.materialId,
        theoretical,
        actual,
        variancePct,
        severity: "critical",
      });
    } else if (variancePct > CONSUMPTION_WARN_PCT) {
      findings.push({
        materialId: coefficient.materialId,
        theoretical,
        actual,
        variancePct,
        severity: "warn",
      });
    }
  }
  return findings;
}
