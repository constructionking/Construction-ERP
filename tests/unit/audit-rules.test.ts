import { describe, it, expect } from "vitest";
import { evaluateConsumptionVariance } from "@/lib/audit/rules/consumption-variance";
import { evaluateReceiptVsRequisition } from "@/lib/audit/rules/receipt-checks";
import { evaluateScanVariance } from "@/lib/audit/rules/scan-variance";

describe("consumption variance rule", () => {
  const CEMENT = "cement-id";
  const SAND = "sand-id";
  // M20-ish: 8 bags cement + 0.45 cum sand per cum of concrete
  const coefficients = [
    { materialId: CEMENT, qtyPerUnit: 8 },
    { materialId: SAND, qtyPerUnit: 0.45 },
  ];

  it("no findings when consumption matches theory", () => {
    const findings = evaluateConsumptionVariance({
      progressQty: 10, // 10 cum poured → theory: 80 bags, 4.5 cum sand
      coefficients,
      actualByMaterial: [
        { materialId: CEMENT, qty: 82 }, // +2.5%
        { materialId: SAND, qty: 4.6 },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("warns above 10%, critical above 25%", () => {
    const findings = evaluateConsumptionVariance({
      progressQty: 10,
      coefficients,
      actualByMaterial: [
        { materialId: CEMENT, qty: 92 }, // +15% → warn
        { materialId: SAND, qty: 6 }, // +33% → critical
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.materialId === CEMENT)!.severity).toBe("warn");
    expect(findings.find((f) => f.materialId === SAND)!.severity).toBe("critical");
  });

  it("boundary: exactly 10% over is not flagged", () => {
    const findings = evaluateConsumptionVariance({
      progressQty: 10,
      coefficients: [{ materialId: CEMENT, qtyPerUnit: 8 }],
      actualByMaterial: [{ materialId: CEMENT, qty: 88 }],
    });
    expect(findings).toEqual([]);
  });

  it("under-consumption is not flagged (work often leads material entry)", () => {
    const findings = evaluateConsumptionVariance({
      progressQty: 10,
      coefficients: [{ materialId: CEMENT, qtyPerUnit: 8 }],
      actualByMaterial: [{ materialId: CEMENT, qty: 40 }],
    });
    expect(findings).toEqual([]);
  });

  it("zero progress → no evaluation (nothing to compare against)", () => {
    const findings = evaluateConsumptionVariance({
      progressQty: 0,
      coefficients,
      actualByMaterial: [{ materialId: CEMENT, qty: 100 }],
    });
    expect(findings).toEqual([]);
  });
});

describe("receipt vs requisition rule", () => {
  it("within 5% tolerance passes", () => {
    expect(
      evaluateReceiptVsRequisition({
        receivedQty: 104,
        previouslyReceivedQty: 0,
        requestedQty: 100,
      })
    ).toBeNull();
  });

  it("cumulative receipts count against the request", () => {
    const finding = evaluateReceiptVsRequisition({
      receivedQty: 30,
      previouslyReceivedQty: 90,
      requestedQty: 100,
    })!;
    expect(finding).not.toBeNull();
    expect(finding.overshootPct).toBeCloseTo(20, 5);
    expect(finding.severity).toBe("warn");
  });

  it("large overshoot is critical", () => {
    const finding = evaluateReceiptVsRequisition({
      receivedQty: 130,
      previouslyReceivedQty: 0,
      requestedQty: 100,
    })!;
    expect(finding.severity).toBe("critical");
  });

  it("no requested qty → not evaluable", () => {
    expect(
      evaluateReceiptVsRequisition({ receivedQty: 50, previouslyReceivedQty: 0, requestedQty: 0 })
    ).toBeNull();
  });
});

describe("scan variance rule", () => {
  it("agreement within 10% → no flag", () => {
    expect(evaluateScanVariance({ computedQty: 105, engineerQty: 100 })).toBeNull();
    expect(evaluateScanVariance({ computedQty: 95, engineerQty: 100 })).toBeNull();
  });

  it("divergence in either direction flags", () => {
    expect(evaluateScanVariance({ computedQty: 115, engineerQty: 100 })!.severity).toBe("warn");
    expect(evaluateScanVariance({ computedQty: 70, engineerQty: 100 })!.severity).toBe("critical");
  });

  it("missing figures → not evaluable", () => {
    expect(evaluateScanVariance({ computedQty: null, engineerQty: 100 })).toBeNull();
    expect(evaluateScanVariance({ computedQty: 100, engineerQty: null })).toBeNull();
    expect(evaluateScanVariance({ computedQty: 100, engineerQty: 0 })).toBeNull();
  });
});
