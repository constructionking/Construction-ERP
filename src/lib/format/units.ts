import type { Unit } from "@prisma/client";

export const UNIT_LABELS: Record<Unit, string> = {
  CUM: "cum",
  SQM: "sqm",
  MTR: "mtr",
  BAG: "bags",
  NOS: "nos",
  KG: "kg",
  TON: "ton",
};

export const ALL_UNITS: Unit[] = ["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"];

export function formatQty(qty: number | string, unit: Unit): string {
  const n = typeof qty === "string" ? Number(qty) : qty;
  if (!Number.isFinite(n)) return "—";
  const digits = unit === "NOS" || unit === "BAG" ? 0 : 2;
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: digits })} ${UNIT_LABELS[unit]}`;
}

export function formatPct(p: number | string, digits = 1): string {
  const n = typeof p === "string" ? Number(p) : p;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
