import type { MaterialCategory, Unit } from "@prisma/client";

// Turns an engineer-typed demand line ("Coarse sand", "50 cft") into the
// material-master shape the stock ledger needs, so an approved + received
// item lands on the owner's inventory under the right category. Pure.

const UNIT_ALIASES: Array<[Unit, RegExp]> = [
  ["BAG", /^(bags?|bg)$/],
  ["CFT", /^(cft|cuft|cu\.?\s*ft|cubic\s*feet|cubic\s*foot|ft3)$/],
  ["CUM", /^(cum|cu\.?\s*m|m3|m³|cubic\s*met(er|re)s?|brass)$/],
  ["KG", /^(kgs?|kilo(gram)?s?)$/],
  ["TON", /^(tons?|tonnes?|mt|t)$/],
  ["NOS", /^(nos?|no\.|nums?|numbers?|pcs?|pieces?|units?|each|ea)$/],
  ["LTR", /^(l|ltrs?|litres?|liters?)$/],
  ["MTR", /^(m|mtrs?|met(er|re)s?|rm|rmt|running\s*met(er|re)s?)$/],
  ["SQM", /^(sqm|sq\.?\s*m|m2|m²|square\s*met(er|re)s?)$/],
  ["SET", /^(sets?)$/],
  ["DAY", /^(days?|day\s*\(hire\)|days\s*\(hire\)|hire\s*days?)$/],
];

/** Free-text unit → master Unit; null when nothing sensible matches. */
export function normalizeUnit(text: string): Unit | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (/^sq\.?\s*ft|sqft|square\s*feet$/.test(t)) return "SQM"; // stored as sqm, see note in UI
  for (const [unit, re] of UNIT_ALIASES) if (re.test(t)) return unit;
  return null;
}

const CATEGORY_RULES: Array<[MaterialCategory, RegExp]> = [
  ["cement", /\b(cement|opc|ppc|psc|white\s*cement)\b/],
  ["steel", /\b(steel|tmt|rebar|reinforcement|binding\s*wire|ms\s*(bar|angle|plate|pipe)|gi\s*wire)\b/],
  ["sand", /\b(sand|m-?sand|river\s*sand|plaster\s*sand)\b/],
  ["aggregate", /\b(aggregate|metal|jelly|grit|stone\s*dust|crusher|gsb|wbm|boulder|\d+\s*mm\s*(stone|metal))\b/],
  ["brick", /\b(bricks?|blocks?|aac|fly\s*ash|hollow\s*block|solid\s*block|paver)\b/],
  ["consumable", /\b(diesel|petrol|oil|curing|admixture|plasticis|water\s*proof|nails?|shuttering\s*oil|chemical|paint|primer|putty|helmet|gloves?|safety|tape|thread|electrode|wire\s*brush)\b/],
  ["tool", /\b(mixer|vibrator|tools?|shovel|spade|pan|ghamela|wheelbarrow|trowel|hammer|drill|cutter|grinder|pump|dewater|scaffold|ladder|prop|jack|plate\s*compactor|roller|hire|rent)\b/],
];

/** Category for the owner's inventory grouping, from the item text + the engineer's type chip. */
export function inferCategory(item: string, type: "material" | "tool" | "other" | undefined): MaterialCategory {
  const t = item.toLowerCase();
  for (const [category, re] of CATEGORY_RULES) if (re.test(t)) return category;
  if (type === "tool") return "tool";
  if (type === "other") return "consumable";
  return "other";
}

/** Canonical master name: trimmed, single-spaced, first letter capitalised. */
export function canonicalMaterialName(item: string): string {
  const s = item.trim().replace(/\s+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
