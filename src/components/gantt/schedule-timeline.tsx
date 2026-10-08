"use client";

// Day-scale schedule timeline: the design logic of components/ui/timeline.tsx
// (provider + context, sticky label column and header, zoom by "% of range
// in view", hover indicator, current-time line, drop guides, data-slot hooks)
// re-expressed for construction schedules that run in days and months, with
// monsoon months banded. The Gantt chart and the draft editor compose these
// primitives; they never measure pixels themselves.

import * as React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { addDays, dayIndex, fmtDay, fmtDayYear, monthsInRange, type MonthSpan } from "./dates";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ============================================================================
 * CONTEXT
 * ========================================================================== */

interface ScheduleTimelineContextValue {
  startIso: string;
  endIso: string;
  todayIso: string | null;
  totalDays: number; // inclusive day count of the range
  pxPerDay: number;
  chartWidth: number;
  labelWidth: number;
  months: MonthSpan[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** px offset of a date's start inside the track (label column excluded). */
  x: (iso: string) => number;
  /** date under a px offset inside the track. */
  isoAt: (px: number) => string;
}

const ScheduleTimelineContext = createContext<ScheduleTimelineContextValue | null>(null);

export function useScheduleTimeline() {
  const ctx = useContext(ScheduleTimelineContext);
  if (!ctx) throw new Error("Schedule timeline parts must be used within ScheduleTimelineProvider");
  return ctx;
}

/* ============================================================================
 * PROVIDER
 * ========================================================================== */

export function ScheduleTimelineProvider({
  startIso,
  endIso,
  todayIso = null,
  monsoonMonths = [6, 7, 8, 9],
  labelWidth = 240,
  zoom = 1,
  children,
  className,
}: {
  startIso: string;
  endIso: string;
  todayIso?: string | null;
  monsoonMonths?: number[];
  labelWidth?: number;
  /** 1 = the whole range fits the viewport; 4 = a quarter of it is in view. */
  zoom?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState(0);

  useIsoLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setWrapperWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWrapperWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Narrow phones get a slimmer label column so the bars keep some room.
  const effectiveLabelWidth =
    wrapperWidth > 0 && wrapperWidth < 560 ? Math.min(labelWidth, 150) : labelWidth;
  const totalDays = Math.max(1, dayIndex(endIso, startIso) + 1);
  const available = wrapperWidth > 0 ? wrapperWidth - effectiveLabelWidth - 2 : 0;
  const basePxPerDay = available > 0 ? available / totalDays : 4;
  const pxPerDay = basePxPerDay * Math.max(1, zoom);
  const chartWidth = totalDays * pxPerDay;

  // Zoom around the viewport centre, so the date being looked at stays put.
  const prevPxPerDay = useRef(pxPerDay);
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevPxPerDay.current;
    prevPxPerDay.current = pxPerDay;
    if (!el || prev === pxPerDay || prev <= 0) return;
    const visible = el.clientWidth - effectiveLabelWidth;
    const centreDays = (el.scrollLeft + visible / 2) / prev;
    el.scrollLeft = Math.max(0, centreDays * pxPerDay - visible / 2);
  }, [pxPerDay, effectiveLabelWidth]);

  const value: ScheduleTimelineContextValue = {
    startIso,
    endIso,
    todayIso,
    totalDays,
    pxPerDay,
    chartWidth,
    labelWidth: effectiveLabelWidth,
    months: monthsInRange(startIso, endIso, monsoonMonths),
    scrollRef,
    x: (iso) => Math.min(Math.max(dayIndex(iso, startIso), 0), totalDays) * pxPerDay,
    isoAt: (px) =>
      addDays(startIso, Math.min(totalDays - 1, Math.max(0, Math.floor(px / pxPerDay)))),
  };

  return (
    <ScheduleTimelineContext.Provider value={value}>
      <div
        ref={wrapperRef}
        data-slot="schedule-timeline"
        className={cn("relative w-full", className)}
        style={
          {
            "--schedule-label-width": `${effectiveLabelWidth}px`,
            "--schedule-chart-width": `${chartWidth}px`,
            "--schedule-px-per-day": pxPerDay,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </ScheduleTimelineContext.Provider>
  );
}

/* ============================================================================
 * VIEWPORT (scroll container + backdrop + hover / drop indicators)
 * ========================================================================== */

export interface ScheduleGuide {
  startIso: string;
  endIso: string; // inclusive
  label: React.ReactNode;
  tone: "valid" | "invalid";
}

export function ScheduleViewport({
  children,
  guide,
  hoverEnabled = true,
  className,
  ...aria
}: {
  children: React.ReactNode;
  /** Drop region drawn across every row while a bar is being dragged. */
  guide?: ScheduleGuide | null;
  hoverEnabled?: boolean;
  className?: string;
  role?: string;
  "aria-label"?: string;
}) {
  const { labelWidth, chartWidth, scrollRef, x, isoAt, todayIso, startIso, endIso } =
    useScheduleTimeline();
  const canvasRef = useRef<HTMLDivElement>(null);
  // Hover lives here, not in the provider: children are stable elements, so
  // moving the mouse re-renders only the indicator, never every row.
  const [hoverPx, setHoverPx] = useState<number | null>(null);

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left - labelWidth;
    setHoverPx(px >= 0 && px <= chartWidth ? px : null);
  };

  const showToday = todayIso !== null && todayIso >= startIso && todayIso <= endIso;
  const hoverIso = hoverEnabled && !guide && hoverPx !== null ? isoAt(hoverPx) : null;

  return (
    <div
      ref={scrollRef}
      data-slot="schedule-viewport"
      className={cn(
        "relative max-h-[70vh] overflow-auto overscroll-x-contain rounded-lg border border-slate-200 bg-white",
        className,
      )}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHoverPx(null)}
      {...aria}
    >
      <div
        ref={canvasRef}
        data-slot="schedule-canvas"
        className="relative"
        style={{ width: labelWidth + chartWidth }}
      >
        {/* Sticky zero-height strip: floating chips stay pinned to the top
            edge while the rows scroll underneath. */}
        <div className="pointer-events-none sticky top-0 z-[12] h-0" aria-hidden>
          {hoverIso ? (
            <Chip left={labelWidth + x(hoverIso) + 0.5}>{fmtDayYear(hoverIso)}</Chip>
          ) : null}
          {guide ? (
            <Chip
              left={labelWidth + (x(guide.startIso) + x(addDays(guide.endIso, 1))) / 2}
              tone={guide.tone}
            >
              {guide.label}
            </Chip>
          ) : null}
        </div>

        <ScheduleBackdrop />

        {children}

        {showToday ? (
          <div
            data-slot="schedule-today-line"
            className="pointer-events-none absolute top-0 bottom-0 z-[3] w-0.5 bg-brand-600/70"
            style={{ left: labelWidth + x(todayIso!) }}
            aria-hidden
          />
        ) : null}

        {hoverIso ? (
          <div
            data-slot="schedule-hover-line"
            className="pointer-events-none absolute top-0 bottom-0 z-[4] w-px bg-accent/60"
            style={{ left: labelWidth + x(hoverIso) }}
            aria-hidden
          />
        ) : null}

        {guide ? <ScheduleDropRegion guide={guide} /> : null}
      </div>
    </div>
  );
}

function Chip({
  left,
  tone = "valid",
  children,
}: {
  left: number;
  tone?: "valid" | "invalid";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute top-1 -translate-x-1/2 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold shadow-md",
        tone === "valid" ? "bg-accent text-accent-foreground" : "bg-red-600 text-white",
      )}
      style={{ left }}
    >
      {children}
    </div>
  );
}

function ScheduleDropRegion({ guide }: { guide: ScheduleGuide }) {
  const { labelWidth, x } = useScheduleTimeline();
  const left = labelWidth + x(guide.startIso);
  const width = Math.max(1, labelWidth + x(addDays(guide.endIso, 1)) - left);
  const edge = guide.tone === "valid" ? "bg-accent" : "bg-red-500";
  return (
    <div
      data-slot="schedule-drop-region"
      data-state={guide.tone}
      className="pointer-events-none absolute top-0 bottom-0 z-[4]"
      style={{ left, width }}
      aria-hidden
    >
      <div className={cn("absolute inset-y-0 left-0 w-0.5", edge)} />
      <div className={cn("absolute inset-y-0 right-0 w-0.5", edge)} />
      <div
        className={cn(
          "absolute inset-0",
          guide.tone === "valid" ? "bg-accent/[0.06]" : "bg-red-500/[0.06]",
        )}
      />
    </div>
  );
}

/** Monsoon bands, month lines and (when zoomed in) week lines behind the rows. */
function ScheduleBackdrop() {
  const { labelWidth, chartWidth, months, x, pxPerDay, startIso, totalDays } =
    useScheduleTimeline();
  const weekLines: number[] = [];
  if (pxPerDay >= 3) {
    // Mondays (UTC day 1)
    const first = new Date(startIso).getUTCDay();
    for (let d = (8 - first) % 7; d < totalDays; d += 7) weekLines.push(d * pxPerDay);
  }
  return (
    <div
      data-slot="schedule-backdrop"
      className="pointer-events-none absolute top-0 bottom-0"
      style={{ left: labelWidth, width: chartWidth }}
      aria-hidden
    >
      {months.map((m) =>
        m.monsoon ? (
          <div
            key={`band-${m.startIso}`}
            data-slot="schedule-monsoon-band"
            className="absolute inset-y-0 bg-brand-500/[0.07]"
            style={{ left: x(m.startIso), width: Math.max(0, x(m.endIso) - x(m.startIso)) }}
          />
        ) : null,
      )}
      {weekLines.map((left) => (
        <div key={`w-${left}`} className="absolute inset-y-0 w-px bg-slate-100" style={{ left }} />
      ))}
      {months.map((m) =>
        m.startIso >= startIso ? (
          <div
            key={`line-${m.startIso}`}
            className="absolute inset-y-0 w-px bg-slate-200"
            style={{ left: x(m.startIso) }}
          />
        ) : null,
      )}
    </div>
  );
}

/* ============================================================================
 * HEADER (sticky: months on top, weeks / days underneath when zoomed in)
 * ========================================================================== */

export function ScheduleHeader({
  columnLabel = "Activity",
  className,
}: {
  columnLabel?: React.ReactNode;
  className?: string;
}) {
  const { labelWidth, chartWidth, months, x, pxPerDay, startIso, totalDays, todayIso, endIso } =
    useScheduleTimeline();

  // Second tier: every day when there is room for a number, else Mondays.
  const ticks: { left: number; label: string; key: string }[] = [];
  if (pxPerDay >= 18) {
    for (let d = 0; d < totalDays; d++) {
      const iso = addDays(startIso, d);
      ticks.push({ left: d * pxPerDay, label: String(new Date(iso).getUTCDate()), key: iso });
    }
  } else if (pxPerDay >= 3) {
    const first = new Date(startIso).getUTCDay();
    for (let d = (8 - first) % 7; d < totalDays; d += 7) {
      const iso = addDays(startIso, d);
      if (d * pxPerDay + 28 > chartWidth) break;
      ticks.push({
        left: d * pxPerDay,
        label: pxPerDay >= 7 ? fmtDay(iso) : String(new Date(iso).getUTCDate()),
        key: iso,
      });
    }
  }
  const showToday = todayIso !== null && todayIso >= startIso && todayIso <= endIso;

  return (
    <div
      data-slot="schedule-header"
      className={cn("sticky top-0 z-[8] flex border-b border-slate-200 bg-white", className)}
    >
      <div
        data-slot="schedule-header-column"
        className="sticky left-0 z-[9] flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
        style={{ width: labelWidth }}
      >
        {columnLabel}
      </div>
      <div className="relative h-12 shrink-0" style={{ width: chartWidth }}>
        {months.map((m) => {
          const left = x(m.startIso);
          const width = x(m.endIso) - left;
          return (
            <div
              key={m.startIso}
              data-slot="schedule-month"
              data-monsoon={m.monsoon || undefined}
              className={cn(
                // No padding on the cell itself: a sliver of a month at the
                // range edge must never be wider than its own width.
                "absolute top-0 flex h-6 items-center overflow-hidden whitespace-nowrap border-l border-slate-200 text-xs font-medium text-slate-600",
                m.monsoon && "bg-brand-500/[0.07] text-brand-800",
              )}
              style={{ left, width }}
              title={m.monsoon ? `${m.label} — monsoon month (work slows)` : m.label}
            >
              {width > 44 ? (
                <span className="px-1.5">
                  {m.label}
                  {m.monsoon && width > 52 ? " ☔" : ""}
                </span>
              ) : null}
            </div>
          );
        })}
        {ticks.map((t) => (
          <div
            key={t.key}
            className="absolute bottom-0 flex h-6 items-center border-l border-slate-100 pl-1 text-[10px] text-slate-400"
            style={{ left: t.left }}
          >
            {t.label}
          </div>
        ))}
        {showToday ? (
          <div
            data-slot="schedule-today-chip"
            className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded bg-brand-600 px-1.5 py-px text-[10px] font-semibold text-white shadow-sm"
            style={{ left: x(todayIso!) }}
          >
            Today
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================================
 * ROW + BAR
 * ========================================================================== */

export function ScheduleRow({
  label,
  variant = "item",
  className,
  children,
  ...props
}: {
  label: React.ReactNode;
  variant?: "group" | "item";
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { labelWidth, chartWidth } = useScheduleTimeline();
  return (
    <div
      data-slot="schedule-row"
      data-variant={variant}
      className={cn(
        "group/row flex border-b border-slate-100",
        variant === "group" ? "h-11" : "h-10",
        className,
      )}
      {...props}
    >
      <div
        data-slot="schedule-row-label"
        className={cn(
          "sticky left-0 z-[6] flex shrink-0 items-center border-r border-slate-200 px-3",
          variant === "group" ? "bg-slate-100" : "bg-white group-hover/row:bg-slate-50",
        )}
        style={{ width: labelWidth }}
      >
        {label}
      </div>
      <div
        data-slot="schedule-row-track"
        className={cn(
          "relative shrink-0",
          // Translucent so monsoon bands and grid lines stay visible beneath.
          variant === "group" ? "bg-slate-500/[0.06]" : "group-hover/row:bg-slate-500/[0.03]",
        )}
        style={{ width: chartWidth }}
      >
        {children}
      </div>
    </div>
  );
}

/** Absolutely positions its content over [start, end] (inclusive) on the track. */
export const ScheduleBar = React.forwardRef<
  HTMLDivElement,
  { start: string; end: string; minWidth?: number } & React.HTMLAttributes<HTMLDivElement>
>(function ScheduleBar({ start, end, minWidth, className, style, ...props }, ref) {
  const { x, pxPerDay } = useScheduleTimeline();
  const left = x(start);
  const width = Math.max(minWidth ?? Math.max(2, pxPerDay), x(addDays(end, 1)) - left);
  return (
    <div
      ref={ref}
      data-slot="schedule-bar"
      className={cn("absolute", className)}
      style={{ left, width, ...style }}
      {...props}
    />
  );
});

/* ============================================================================
 * ZOOM CONTROL
 * ========================================================================== */

export const MAX_ZOOM = 12;

export function ScheduleZoom({
  zoom,
  onZoomChange,
  className,
}: {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}) {
  return (
    <div data-slot="schedule-zoom" className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        onClick={() => onZoomChange(Math.max(1, zoom / 1.5))}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <Slider
        className="w-28 sm:w-40"
        min={1}
        max={MAX_ZOOM}
        step={0.25}
        value={[zoom]}
        onValueChange={(v) => onZoomChange(v[0])}
        aria-label="Zoom level"
      />
      <button
        type="button"
        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom * 1.5))}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <span className="w-9 text-xs tabular-nums text-slate-500">{zoom.toFixed(zoom < 10 ? 1 : 0)}×</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        onClick={() => onZoomChange(1)}
        disabled={zoom === 1}
        title="Fit the whole schedule"
      >
        <Maximize2 className="h-3.5 w-3.5" /> Fit
      </button>
    </div>
  );
}
