import type { ActivityCategory } from "@prisma/client";

// Keyword classifier for BOQ line items. Priority-ORDERED: reinforcement and
// shuttering must be tested before concreting because "Reinforcement for RCC
// columns" and "Shuttering to RCC slab" both mention concrete terms.

export const CATEGORY_KEYWORDS: Array<{ category: ActivityCategory; pattern: RegExp }> = [
  { category: "reinforcement", pattern: /reinforc|bar bending|\btmt\b|fe\s?-?\s?500|fe\s?-?\s?415|steel bar|rebar|binding wire/i },
  { category: "shuttering", pattern: /shutter|form\s?work|centering|centring|staging|scaffold/i },
  { category: "concreting", pattern: /\brcc\b|\bpcc\b|concret|\bm\s?-?\s?(10|15|20|25|30|35|40)\b|cement concrete|grouting|screed/i },
  { category: "earthwork", pattern: /excavat|earth\s?work|filling|back\s?fill|soling|anti[- ]?termite|levell?ing|murrum|compaction|dewatering/i },
  { category: "masonry", pattern: /brick|block\s?work|masonry|stone work|\baac\b|rubble/i },
  { category: "plaster", pattern: /plaster|pointing|neeru|gypsum punning/i },
  { category: "waterproofing", pattern: /water\s?proof|damp proof|\bdpc\b|membrane|injection grout/i },
  { category: "flooring", pattern: /floor|tile|tiling|granite|marble|kota|skirting|dado|vitrified|paver/i },
  { category: "finishes", pattern: /paint|putty|primer|distemper|polish|texture|white\s?wash|finish|emulsion|enamel/i },
  { category: "external", pattern: /compound wall|paving|drain|landscap|external|road work|kerb|sewer|manhole/i },
];

export function classifyRow(input: {
  description: string;
  sectionPath: string[];
  sheetName: string;
}): ActivityCategory {
  const haystacks = [input.description, input.sectionPath.join(" "), input.sheetName];
  for (const hay of haystacks) {
    if (!hay) continue;
    for (const { category, pattern } of CATEGORY_KEYWORDS) {
      if (pattern.test(hay)) return category;
    }
  }
  return "general";
}

// ---------------------------------------------------------------------------
// Code assignment: prefer the sheet's own item numbers; otherwise generate
// PREFIX-NN per category. Never collide with existing site codes or with
// other codes assigned in this batch.

const CODE_RE = /^[A-Z0-9._-]{1,20}$/i;

export const CATEGORY_CODE_PREFIX: Record<ActivityCategory, string> = {
  earthwork: "EAR",
  concreting: "CON",
  reinforcement: "REI",
  shuttering: "SHU",
  masonry: "MAS",
  plaster: "PLA",
  waterproofing: "WPF",
  flooring: "FLR",
  finishes: "FIN",
  external: "EXT",
  general: "GEN",
};

export interface AssignedCode {
  code: string;
  duplicateInFile: boolean;
}

export function assignCodes(
  rows: Array<{ itemNo: string | null; category: ActivityCategory }>,
  existingCodes: Set<string>,
): AssignedCode[] {
  const taken = new Set<string>([...existingCodes].map((c) => c.toUpperCase()));
  const batchTaken = new Set<string>();
  const counters = new Map<string, number>();

  const nextGenerated = (category: ActivityCategory): string => {
    const prefix = CATEGORY_CODE_PREFIX[category];
    let n = counters.get(prefix) ?? 0;
    let code: string;
    do {
      n++;
      code = `${prefix}-${String(n).padStart(2, "0")}`;
      // Generated codes must never hit an EXISTING activity — that would
      // silently update it. (Sheet-supplied item numbers may match existing
      // codes on purpose; that is the re-import/update path.)
    } while (batchTaken.has(code) || taken.has(code));
    counters.set(prefix, n);
    return code;
  };

  return rows.map((row) => {
    const raw = row.itemNo?.trim().toUpperCase() ?? "";
    let duplicateInFile = false;
    let code: string;

    if (raw && CODE_RE.test(raw) && !batchTaken.has(raw)) {
      code = raw;
    } else if (raw && CODE_RE.test(raw)) {
      // Same item number appears twice in the file — suffix the second.
      duplicateInFile = true;
      let suffix = 2;
      do {
        code = `${raw.slice(0, 20 - String(suffix).length - 1)}-${suffix}`;
        suffix++;
      } while (batchTaken.has(code));
    } else {
      code = nextGenerated(row.category);
    }

    batchTaken.add(code);
    return { code, duplicateInFile };
  });
}
