"use client";

// Locked-baseline Gantt: MAIN activities (structures) as top-level bars
// spanning their children; click a main activity to expand its trade items.
// Ungrouped leaves render at top level. Per activity: baseline bar, actual
// progress fill, dashed forecast extension and a slip badge, on a zoomable
// day-scale timeline with monsoon months banded. Read-only — the baseline is
// locked; re-planning happens in the draft editor.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { chartRange, spanDays } from "./dates";
import {
  ScheduleBar,
  ScheduleHeader,
  ScheduleRow,
  ScheduleTimelineProvider,
  ScheduleViewport,
  ScheduleZoom,
  useScheduleTimeline,
} from "./schedule-timeline";

export interface GanttRow {
  code: string;
  name: string;
  plannedStart: string; // yyyy-mm-dd
  plannedEnd: string;
  progressPct: number; // 0..100
  forecastEnd: string | null;
  slipPct: number | null;
  contractorName: string | null;
  // Two-level WBS rendering: parents are MAIN activities (structures) whose
  // bar is the derived span of their children; children indent under them.
  level?: 0 | 1;
  isParent?: boolean;
  expanded?: boolean;
  childCount?: number;
}

export interface GanttGroup {
  parent: GanttRow | null; // null = ungrouped leaves
  children: GanttRow[];
}

function slipTone(slipPct: number | null): "ok" | "warn" | "critical" {
  if (slipPct === null || slipPct <= 10) return "ok";
  return slipPct > 25 ? "critical" : "warn";
}

export function GanttChart({
  groups,
  todayIso,
  monsoonMonths = [6, 7, 8, 9],
}: {
  groups: GanttGroup[];
  todayIso: string;
  monsoonMonths?: number[];
}) {
  // Default collapsed — the owner sees main activities first (the ungrouped
  // set always shows, so flat sites look unchanged).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useState(1);

  const parentCodes = groups.flatMap((g) => (g.parent ? [g.parent.code] : []));
  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

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

  // Range over EVERY row (not just visible ones) so expanding never rescales.
  const range = useMemo(() => {
    const all = groups.flatMap((g) => (g.parent ? [g.parent, ...g.children] : g.children));
    return chartRange(
      all.map((r) => ({ start: r.plannedStart, end: r.plannedEnd })),
      3,
      7,
      [todayIso, ...all.flatMap((r) => (r.forecastEnd ? [r.forecastEnd] : []))],
    );
  }, [groups, todayIso]);
  if (!range || rows.length === 0) return null;

  const allOpen = parentCodes.length > 0 && parentCodes.every((c) => expanded.has(c));

  return (
    <ScheduleTimelineProvider
      startIso={range.startIso}
      endIso={range.endIso}
      todayIso={todayIso}
      monsoonMonths={monsoonMonths}
      zoom={zoom}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScheduleZoom zoom={zoom} onZoomChange={setZoom} />
        {parentCodes.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(parentCodes))}
          >
            {allOpen ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>

      <ScheduleViewport aria-label="Gantt chart: planned baseline versus actual progress per activity">
        <ScheduleHeader columnLabel={parentCodes.length > 0 ? "Main activity / item" : "Activity"} />
        {rows.map((row) => (
          <GanttChartRow key={row.code} row={row} onToggle={toggle} />
        ))}
      </ScheduleViewport>

      <GanttLegend />
    </ScheduleTimelineProvider>
  );
}

function GanttChartRow({ row, onToggle }: { row: GanttRow; onToggle: (code: string) => void }) {
  const tone = slipTone(row.slipPct);
  const days = spanDays(row.plannedStart, row.plannedEnd);
  const progress = Math.max(0, Math.min(100, row.progressPct));
  const tooltip =
    `${row.code} ${row.name}\nPlanned ${row.plannedStart} → ${row.plannedEnd} (${days}d)` +
    `\nProgress ${progress.toFixed(0)}%` +
    (row.contractorName ? `\nContractor ${row.contractorName}` : "") +
    (row.forecastEnd ? `\nForecast finish ${row.forecastEnd}` : "") +
    (row.slipPct !== null && row.slipPct > 0 ? `\nSlip ${row.slipPct.toFixed(0)}%` : "");

  const label = row.isParent ? (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      onClick={(e) => {
        e.stopPropagation(); // the row itself also toggles on click
        onToggle(row.code);
      }}
      aria-expanded={row.expanded}
      title={`${row.name} — click to ${row.expanded ? "collapse" : "expand"}`}
    >
      {row.expanded ? (
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{row.name}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {row.childCount ?? 0} items · {progress.toFixed(0)}% done
        </span>
      </span>
    </button>
  ) : (
    <div className={cn("min-w-0", row.level === 1 && "pl-5")} title={tooltip}>
      <div className="truncate text-xs font-semibold text-slate-800">{row.code}</div>
      <div className="truncate text-[11px] text-slate-500">
        {row.name}
        {row.contractorName ? ` · ${row.contractorName}` : ""}
      </div>
    </div>
  );

  const slipped = row.forecastEnd !== null && row.forecastEnd > row.plannedEnd;
  const badgeAnchor = slipped ? row.forecastEnd! : row.plannedEnd;

  return (
    <ScheduleRow
      label={label}
      variant={row.isParent ? "group" : "item"}
      onClick={row.isParent ? () => onToggle(row.code) : undefined}
      className={row.isParent ? "cursor-pointer" : undefined}
    >
      {/* baseline bar with the actual-progress fill inside it */}
      <ScheduleBar
        start={row.plannedStart}
        end={row.plannedEnd}
        title={tooltip}
        data-state={tone}
        className={cn(
          "top-1/2 z-[5] -translate-y-1/2 overflow-hidden rounded-md",
          row.isParent
            ? "h-4 border border-slate-500 bg-slate-300"
            : "h-3.5 bg-slate-300 group-hover/row:ring-2 group-hover/row:ring-brand-300",
        )}
      >
        <div
          data-slot="gantt-actual"
          className="h-full rounded-r-md bg-brand-500"
          style={{ width: `${progress}%` }}
        />
      </ScheduleBar>

      {/* forecast extension past the planned end */}
      {slipped ? (
        <ScheduleBar
          start={row.plannedEnd}
          end={row.forecastEnd!}
          minWidth={0}
          className={cn(
            "top-1/2 z-[5] border-t-2 border-dashed",
            tone === "critical"
              ? "border-red-600"
              : tone === "warn"
                ? "border-amber-600"
                : "border-slate-400",
          )}
          style={{ transform: "translateY(-1px)" }}
          aria-hidden
        />
      ) : null}

      {/* slip badge just past the bar / forecast end */}
      {tone !== "ok" ? (
        <SlipBadge anchorIso={badgeAnchor} slipPct={row.slipPct!} tone={tone} />
      ) : null}
    </ScheduleRow>
  );
}

function SlipBadge({
  anchorIso,
  slipPct,
  tone,
}: {
  anchorIso: string;
  slipPct: number;
  tone: "warn" | "critical";
}) {
  const { x, pxPerDay, chartWidth } = useScheduleTimeline();
  // Sits just past the anchor day; flips inside when it would overflow the
  // right edge of the chart.
  const flip = x(anchorIso) + pxPerDay + 48 > chartWidth;
  return (
    <ScheduleBar start={anchorIso} end={anchorIso} className="top-1/2 z-[5] -translate-y-1/2">
      <span
        className={cn(
          "absolute whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold text-white ring-2 ring-white",
          flip ? "right-full mr-1.5" : "left-full ml-1.5",
          tone === "critical" ? "bg-red-600" : "bg-amber-600",
        )}
        style={{ top: "-0.55rem" }}
      >
        +{slipPct.toFixed(0)}%
      </span>
    </ScheduleBar>
  );
}

function GanttLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded bg-slate-300" /> Planned (locked baseline)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded bg-brand-500" /> Actual progress
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-6 border-t-2 border-dashed border-amber-600" /> Forecast slip
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white">+%</span>
        Slip &gt;10% <span className="text-red-600">(red &gt;25%)</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm border border-slate-200 bg-brand-500/[0.07]" /> Monsoon months ☔
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 bg-brand-600/70" /> Today
      </span>
    </div>
  );
}
