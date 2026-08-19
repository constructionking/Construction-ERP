// Pure rule: contractor slipping beyond 10% of the time allotted to them.

export const DELAY_WARN_PCT = 10;
export const DELAY_CRITICAL_PCT = 25;

export interface DelayInput {
  slipPct: number;
  contractorName: string | null;
}

export function evaluateContractorDelay(
  input: DelayInput
): { severity: "warn" | "critical"; slipPct: number } | null {
  if (!input.contractorName) return null; // departmental work is cost-audited, not delay-flagged
  if (input.slipPct <= DELAY_WARN_PCT) return null;
  return {
    severity: input.slipPct > DELAY_CRITICAL_PCT ? "critical" : "warn",
    slipPct: input.slipPct,
  };
}
