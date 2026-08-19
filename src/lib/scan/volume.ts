// Shape-template volume estimation — the deterministic fallback when a
// photogrammetry scan fails or scores low confidence. Standard stockpile
// geometry, dimensions in metres, result in CUM.

export type PileShape = "cone" | "rect_stack" | "windrow";

export interface PileDimensions {
  /** cone: base diameter; rect_stack/windrow: length */
  length: number;
  /** rect_stack/windrow: width (unused for cone) */
  width?: number;
  height: number;
}

/** Nominal accuracy band of the template method, shown in the UI. */
export const TEMPLATE_ACCURACY_BAND_PCT = 25;

export function templateVolumeCum(shape: PileShape, dims: PileDimensions): number {
  if (dims.length <= 0 || dims.height <= 0) return 0;
  switch (shape) {
    case "cone": {
      // V = (π/12) · D² · h
      const d = dims.length;
      return (Math.PI / 12) * d * d * dims.height;
    }
    case "rect_stack": {
      // Neat rectangular stack (e.g. bricks): exact prism volume.
      const w = dims.width ?? 0;
      if (w <= 0) return 0;
      return dims.length * w * dims.height;
    }
    case "windrow": {
      // Elongated pile with roughly triangular cross-section: V = ½ · W · H · L
      const w = dims.width ?? 0;
      if (w <= 0) return 0;
      return 0.5 * w * dims.height * dims.length;
    }
  }
}

export interface MaterialConversion {
  unit: "CUM" | "SQM" | "MTR" | "BAG" | "NOS" | "KG" | "TON";
  densityKgPerCum: number | null;
  unitsPerCum: number | null;
}

/**
 * Convert a measured pile volume into the material's stock unit.
 * Returns null when the material master lacks the needed conversion factor.
 */
export function volumeToQty(volumeCum: number, material: MaterialConversion): number | null {
  if (volumeCum < 0) return null;
  switch (material.unit) {
    case "CUM":
      return volumeCum;
    case "NOS":
    case "BAG":
      return material.unitsPerCum !== null ? volumeCum * material.unitsPerCum : null;
    case "KG":
      return material.densityKgPerCum !== null ? volumeCum * material.densityKgPerCum : null;
    case "TON":
      return material.densityKgPerCum !== null
        ? (volumeCum * material.densityKgPerCum) / 1000
        : null;
    default:
      return null; // SQM/MTR materials are not stockpile-scannable
  }
}

export function variancePct(computedQty: number, referenceQty: number): number | null {
  if (referenceQty <= 0) return null;
  return Number((((computedQty - referenceQty) / referenceQty) * 100).toFixed(1));
}
