// Chart palette — the dataviz reference instance's LIGHT values (the app
// deliberately commits to a single light theme; backgrounds are explicit).
// Categorical hues are assigned in FIXED order, never cycled; status colors
// are reserved for state and never impersonate a series.

export const SERIES = {
  s1: "#2a78d6", // blue    — slot 1 (planned / primary)
  s2: "#eb6834", // orange  — slot 2 (actual / secondary)
  s3: "#1baf7a", // aqua    — slot 3
  s4: "#eda100", // yellow  — slot 4
} as const;

export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

// Sequential blue ramp (magnitude, light→dark).
export const SEQ_BLUE = [
  "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b",
] as const;

// Diverging: blue (ahead/good) ↔ red (behind/bad) with a neutral midpoint.
export const DIVERGING = {
  coolArm: ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab"], // ahead, light→strong
  mid: "#f0efec",
  warmArm: ["#f6d9d9", "#eda3a2", "#e34948", "#b02a2a"], // behind, light→strong
} as const;

export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  surface: "#fcfcfb",
  deltaGood: "#006300",
} as const;

export const MONSOON_BAND = "rgba(35, 121, 221, 0.07)";

/** Diverging color for a delta in percentage points, capped at ±cap. */
export function divergingColor(deltaPp: number, cap = 25): string {
  if (Math.abs(deltaPp) < 1) return DIVERGING.mid;
  const arm = deltaPp > 0 ? DIVERGING.coolArm : DIVERGING.warmArm;
  const t = Math.min(1, Math.abs(deltaPp) / cap);
  return arm[Math.min(arm.length - 1, Math.floor(t * arm.length))];
}

/** Ink color that clears contrast on a given fill (for in-cell labels). */
export function inkOn(fillHex: string): string {
  const n = parseInt(fillHex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? INK.primary : "#ffffff";
}
