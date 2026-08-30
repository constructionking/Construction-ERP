"use client";

import { useState } from "react";
import { GanttSvg, type GanttRow } from "./GanttSvg";

// Interactive two-level Gantt: MAIN activities (structures) as top-level bars
// spanning their children; click a main activity to expand its trade items.
// Ungrouped leaves render at top level. The SVG itself stays a pure renderer.

export interface GanttGroup {
  parent: GanttRow | null; // null = ungrouped leaves
  children: GanttRow[];
}

export function GanttChart({
  groups,
  todayIso,
  monsoonMonths,
}: {
  groups: GanttGroup[];
  todayIso: string;
  monsoonMonths?: number[];
}) {
  // Default collapsed — the owner sees main activities first (single
  // ungrouped set expands automatically so flat sites look unchanged).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const rows: GanttRow[] = [];
  for (const group of groups) {
    if (!group.parent) {
      rows.push(...group.children.map((c) => ({ ...c, level: 0 as const })));
      continue;
    }
    const isOpen = expanded.has(group.parent.code);
    rows.push({
      ...group.parent,
      level: 0,
      isParent: true,
      expanded: isOpen,
      childCount: group.children.length,
    });
    if (isOpen) rows.push(...group.children.map((c) => ({ ...c, level: 1 as const })));
  }

  return (
    <GanttSvg
      rows={rows}
      todayIso={todayIso}
      monsoonMonths={monsoonMonths}
      onRowClick={(code) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(code)) next.delete(code);
          else next.add(code);
          return next;
        })
      }
    />
  );
}
