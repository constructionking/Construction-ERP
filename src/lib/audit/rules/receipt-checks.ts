// Pure rules on a material receipt.

export const RECEIPT_OVER_REQUISITION_TOLERANCE = 1.05; // 5% over is normal

export interface ReceiptVsRequisitionInput {
  receivedQty: number;
  /** Total qty of the same material previously received against the requisition */
  previouslyReceivedQty: number;
  requestedQty: number;
}

export function evaluateReceiptVsRequisition(
  input: ReceiptVsRequisitionInput
): { severity: "warn" | "critical"; overshootPct: number } | null {
  if (input.requestedQty <= 0) return null;
  const totalReceived = input.receivedQty + input.previouslyReceivedQty;
  const limit = input.requestedQty * RECEIPT_OVER_REQUISITION_TOLERANCE;
  if (totalReceived <= limit) return null;
  const overshootPct = ((totalReceived - input.requestedQty) / input.requestedQty) * 100;
  return { severity: overshootPct > 25 ? "critical" : "warn", overshootPct };
}
