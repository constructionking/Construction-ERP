// Pure rule: departmental labour cost per unit vs the owner's benchmark.

export interface LabourBenchmarkInput {
  costPerUnit: number;
  benchmarkCostPerUnit: number;
}

export interface LabourBenchmarkFinding {
  costPerUnit: number;
  benchmarkCostPerUnit: number;
  overrunPct: number;
  severity: "warn" | "critical";
}

export const LABOUR_CRITICAL_OVERRUN_PCT = 20;

export function evaluateLabourCost(
  input: LabourBenchmarkInput
): LabourBenchmarkFinding | null {
  if (input.benchmarkCostPerUnit <= 0 || input.costPerUnit <= input.benchmarkCostPerUnit) {
    return null;
  }
  const overrunPct =
    ((input.costPerUnit - input.benchmarkCostPerUnit) / input.benchmarkCostPerUnit) * 100;
  return {
    costPerUnit: input.costPerUnit,
    benchmarkCostPerUnit: input.benchmarkCostPerUnit,
    overrunPct,
    severity: overrunPct > LABOUR_CRITICAL_OVERRUN_PCT ? "critical" : "warn",
  };
}
