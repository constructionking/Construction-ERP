import type { ActivityCategory } from "@prisma/client";

// Monsoon-aware productivity derating for Indian sites. During monsoon months
// a day yields only `multiplier × norm` output. Owner-tunable per suggestion
// run; these defaults reflect typical impact per activity category.

export const MONSOON_MONTHS_DEFAULT = [6, 7, 8, 9]; // June–September

export const MONSOON_MULTIPLIERS_DEFAULT: Record<ActivityCategory, number> = {
  earthwork: 0.4,
  concreting: 0.6,
  masonry: 0.8,
  plaster: 0.8,
  waterproofing: 0.5,
  flooring: 1.0,
  finishes: 1.0,
  external: 0.5,
  general: 0.8,
};

export interface MonsoonConfig {
  months: number[];
  multipliers: Record<ActivityCategory, number>;
}

export const DEFAULT_MONSOON_CONFIG: MonsoonConfig = {
  months: MONSOON_MONTHS_DEFAULT,
  multipliers: MONSOON_MULTIPLIERS_DEFAULT,
};

export function isMonsoonDay(date: Date, config: MonsoonConfig): boolean {
  return config.months.includes(date.getUTCMonth() + 1);
}

export function dayMultiplier(
  date: Date,
  category: ActivityCategory,
  config: MonsoonConfig
): number {
  return isMonsoonDay(date, config) ? (config.multipliers[category] ?? 1) : 1;
}
