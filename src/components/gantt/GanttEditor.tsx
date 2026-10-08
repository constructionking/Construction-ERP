"use client";

// Draggable draft-schedule editor for the pre-lock review step. The owner
// drags a bar to MOVE an activity, or its end handles to STRETCH/SHORTEN it.
// While dragging, the bar stays put (faded) and a ghost shows where it will
// land, snapped to whole days, with the new dates pinned at the top of the
// chart and a drop region across every row; release commits, Esc cancels.
// Keyboard: focus a bar or handle, Space to pick up, ←/→ a day at a time,
// Space to drop. This edits the DRAFT only — locking still goes through the
// baseline API, and locked baselines remain immutable.

import * as React from "react";
import { useId, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Modifier,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  chartRange,
  fmtDay,
  overlapsMonsoon,
  previewRange,
  snapDays,
  spanDays,
  type DragMode,
} from "./dates";
import {
  ScheduleBar,
  ScheduleHeader,
  ScheduleRow,
  ScheduleTimelineProvider,
  ScheduleViewport,
  ScheduleZoom,
  useScheduleTimeline,
  type ScheduleGuide,
} from "./schedule-timeline";

export type EditorRow =
  | { kind: "heading"; label: string }
  | { kind: "item"; id: string; label: string };

type Range = { start: string; end: string };

interface DragState {
  id: string;
  mode: DragMode;
  orig: Range;
  preview: Range;
  invalidReason: string | null;
}

export function GanttEditor({
  rows,
  dates,
  onChange,
  monsoonMonths = [6, 7, 8, 9],
  todayIso = null,
  minStartIso = null,
  snapIntervalDays = 1,
}: {
  rows: EditorRow[];
  dates: Record<string, Range>;
  onChange: (id: string, start: string, end: string) => void;
  monsoonMonths?: number[];
  todayIso?: string | null;
  /** Project start: a drag may not pull an activity earlier than this. */
  minStartIso?: string | null;
  snapIntervalDays?: number;
}) {
  const [zoom, setZoom] = useState(1);

  // Generous padding so ordinary drags have room on both sides; the range
  // only re-fits after a drop, never mid-gesture.
  const range = useMemo(
    () =>
      chartRange(
        rows.flatMap((r) => (r.kind === "item" && dates[r.id] ? [dates[r.id]] : [])),
        14,
        21,
      ),
    [rows, dates],
  );
  if (!range) return null;

  return (
    <ScheduleTimelineProvider
      startIso={range.startIso}
      endIso={range.endIso}
      todayIso={todayIso}
      monsoonMonths={monsoonMonths}
      zoom={zoom}
      className="space-y-2"
    >
      <ScheduleZoom zoom={zoom} onZoomChange={setZoom} />
      <EditorCanvas
        rows={rows}
        dates={dates}
        onChange={onChange}
        monsoonMonths={monsoonMonths}
        minStartIso={minStartIso}
        snapIntervalDays={snapIntervalDays}
      />
    </ScheduleTimelineProvider>
  );
}

/* Snap the visual drag to whole days and lock it to the time axis. */
function useModifiers(pxPerDay: number, snapInterval: number): Modifier[] {
  return useMemo(() => {
    const step = pxPerDay * Math.max(1, snapInterval);
    const horizontalSnap: Modifier = ({ transform }) => ({
      ...transform,
      x: step > 0 ? Math.round(transform.x / step) * step : transform.x,
      y: 0,
    });
    return [horizontalSnap];
  }, [pxPerDay, snapInterval]);
}

function EditorCanvas({
  rows,
  dates,
  onChange,
  monsoonMonths,
  minStartIso,
  snapIntervalDays,
}: {
  rows: EditorRow[];
  dates: Record<string, Range>;
  onChange: (id: string, start: string, end: string) => void;
  monsoonMonths: number[];
  minStartIso: string | null;
  snapIntervalDays: number;
}) {
  const { pxPerDay } = useScheduleTimeline();
  const [drag, setDrag] = useState<DragState | null>(null);
  // Stable id keeps dnd-kit's aria-describedby identical on server and client.
  const dndId = useId();
  const labelOf = (id: string) => {
    const row = rows.find((r) => r.kind === "item" && r.id === id);
    return row && row.kind === "item" ? row.label : "activity";
  };
  const describe = (event: { active: { data: { current?: unknown } } }) => {
    const data = event.active.data.current as { activityId: string; mode: DragMode } | undefined;
    if (!data) return "activity";
    const what = data.mode === "move" ? "" : data.mode === "start" ? "start of " : "end of ";
    return what + labelOf(data.activityId);
  };

  // The keyboard sensor reads the CURRENT scale, even after zooming.
  const stepRef = useRef(pxPerDay * snapIntervalDays);
  stepRef.current = pxPerDay * snapIntervalDays;
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      const dir = event.code === "ArrowRight" ? 1 : -1;
      return { ...currentCoordinates, x: currentCoordinates.x + dir * stepRef.current };
    }
    return undefined;
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const modifiers = useModifiers(pxPerDay, snapIntervalDays);

  const validate = (orig: Range, next: Range): string | null => {
    // Only block moves that make things worse: a bar already sitting before
    // the project start (e.g. the start field changed after modelling) can
    // still be dragged later.
    if (minStartIso && next.start < minStartIso && next.start < orig.start) {
      return `Before project start (${fmtDay(minStartIso)})`;
    }
    return null;
  };

  const compute = (id: string, mode: DragMode, deltaPx: number): DragState | null => {
    const orig = dates[id];
    if (!orig || pxPerDay <= 0) return null;
    const deltaDays = snapDays(deltaPx / pxPerDay, snapIntervalDays);
    const preview = previewRange(orig, mode, deltaDays);
    return { id, mode, orig, preview, invalidReason: validate(orig, preview) };
  };

  const dragData = (event: DragStartEvent | DragMoveEvent | DragEndEvent) =>
    event.active.data.current as { activityId: string; mode: DragMode } | undefined;

  const onDragStart = (event: DragStartEvent) => {
    const data = dragData(event);
    if (data) setDrag(compute(data.activityId, data.mode, 0));
  };
  const onDragMove = (event: DragMoveEvent) => {
    const data = dragData(event);
    if (!data) return;
    const next = compute(data.activityId, data.mode, event.delta.x);
    setDrag((prev) =>
      prev &&
      next &&
      prev.preview.start === next.preview.start &&
      prev.preview.end === next.preview.end
        ? prev // same snapped day — skip the re-render
        : next,
    );
  };
  const onDragEnd = (event: DragEndEvent) => {
    const data = dragData(event);
    setDrag(null);
    if (!data) return;
    const result = compute(data.activityId, data.mode, event.delta.x);
    if (!result || result.invalidReason) return;
    if (result.preview.start !== result.orig.start || result.preview.end !== result.orig.end) {
      onChange(data.activityId, result.preview.start, result.preview.end);
    }
  };

  const guide: ScheduleGuide | null = drag
    ? {
        startIso: drag.preview.start,
        endIso: drag.preview.end,
        tone: drag.invalidReason ? "invalid" : "valid",
        label: drag.invalidReason ?? (
          <>
            {fmtDay(drag.preview.start)} → {fmtDay(drag.preview.end)} ·{" "}
            {spanDays(drag.preview.start, drag.preview.end)}d
            {overlapsMonsoon(drag.preview.start, drag.preview.end, monsoonMonths) ? " ☔" : ""}
          </>
        ),
      }
    : null;

  // Main-activity headings show the derived span of the items under them.
  const headingSpans = useMemo(() => {
    const spans = new Map<number, Range>();
    let current = -1;
    rows.forEach((row, i) => {
      if (row.kind === "heading") {
        current = i;
        return;
      }
      const d = dates[row.id];
      if (current < 0 || !d?.start || !d?.end) return;
      const span = spans.get(current);
      spans.set(current, {
        start: !span || d.start < span.start ? d.start : span.start,
        end: !span || d.end > span.end ? d.end : span.end,
      });
    });
    return spans;
  }, [rows, dates]);

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      modifiers={modifiers}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To reschedule, press space to pick up the bar, use the left and right arrow keys to move it a day at a time, then press space to drop or escape to cancel.",
        },
        announcements: {
          onDragStart: (e) => `Picked up ${describe(e)}.`,
          onDragOver: () => undefined,
          onDragMove: () =>
            drag
              ? drag.invalidReason ??
                `${fmtDay(drag.preview.start)} to ${fmtDay(drag.preview.end)}, ${spanDays(drag.preview.start, drag.preview.end)} days.`
              : undefined,
          onDragEnd: (e) => `Dropped ${describe(e)}.`,
          onDragCancel: (e) => `Cancelled. ${describe(e)} keeps its dates.`,
        },
      }}
    >
      <ScheduleViewport
        guide={guide}
        hoverEnabled={!drag}
        role="application"
        aria-label="Draft schedule editor: drag bars to move, drag their edges to resize"
      >
        <ScheduleHeader columnLabel="Activity" />
        {rows.map((row, i) => {
          if (row.kind === "heading") {
            const span = headingSpans.get(i);
            return (
              <ScheduleRow
                key={`h-${i}`}
                variant="group"
                label={
                  <span className="truncate text-sm font-semibold text-slate-900" title={row.label}>
                    {row.label}
                  </span>
                }
              >
                {span ? (
                  <ScheduleBar
                    start={span.start}
                    end={span.end}
                    className="top-1/2 z-[5] h-2 -translate-y-1/2 rounded-full bg-slate-400/70"
                    title={`${row.label}\n${span.start} → ${span.end} (${spanDays(span.start, span.end)}d)`}
                  />
                ) : null}
              </ScheduleRow>
            );
          }
          const d = dates[row.id];
          return (
            <ScheduleRow
              key={row.id}
              label={
                <span className="truncate pl-3 text-xs font-medium text-slate-800" title={row.label}>
                  {row.label}
                </span>
              }
            >
              {d?.start && d?.end ? (
                <EditableBar
                  id={row.id}
                  label={row.label}
                  range={d}
                  active={drag?.id === row.id ? drag : null}
                />
              ) : null}
            </ScheduleRow>
          );
        })}
      </ScheduleViewport>
      <p className="px-1 text-xs text-slate-500">
        Snaps to whole days · the dates in the table below follow on release · Esc cancels a drag ·
        keyboard: focus a bar, Space, ←/→, Space.
      </p>
    </DndContext>
  );
}

function EditableBar({
  id,
  label,
  range,
  active,
}: {
  id: string;
  label: string;
  range: Range;
  active: DragState | null;
}) {
  const move = useDraggable({ id: `${id}:move`, data: { activityId: id, mode: "move" } });
  const start = useDraggable({ id: `${id}:start`, data: { activityId: id, mode: "start" } });
  const end = useDraggable({ id: `${id}:end`, data: { activityId: id, mode: "end" } });
  const days = spanDays(range.start, range.end);
  const dragging = active !== null;
  const invalid = active?.invalidReason != null;

  return (
    <>
      <ScheduleBar
        ref={move.setNodeRef}
        start={range.start}
        end={range.end}
        minWidth={14}
        data-state={dragging ? "dragging" : "idle"}
        className={cn(
          "group/bar top-1/2 z-[5] flex h-5 -translate-y-1/2 cursor-grab items-center justify-center rounded-md border border-brand-600 bg-brand-300 text-[10px] font-semibold text-brand-950 shadow-sm outline-none transition-[opacity,box-shadow] active:cursor-grabbing",
          "hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
          dragging && "opacity-40 shadow-none",
        )}
        style={{ touchAction: "none" }}
        title={`${label}\n${range.start} → ${range.end} (${days}d)\nDrag to move · drag an edge to resize`}
        {...move.listeners}
        {...move.attributes}
        aria-label={`Move ${label}, ${range.start} to ${range.end}`}
      >
        <span className="pointer-events-none truncate px-2">{days}d</span>

        {/* edge handles: drag = stretch / shorten */}
        {(["start", "end"] as const).map((edge) => {
          const handle = edge === "start" ? start : end;
          return (
            <span
              key={edge}
              ref={handle.setNodeRef}
              {...handle.listeners}
              {...handle.attributes}
              aria-label={`${edge === "start" ? "Change start of" : "Change end of"} ${label} (${edge === "start" ? range.start : range.end})`}
              className={cn(
                "absolute inset-y-[-3px] flex w-2.5 cursor-ew-resize items-center justify-center rounded-sm bg-brand-600 text-white outline-none",
                "opacity-70 transition-opacity group-hover/bar:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-500",
                edge === "start" ? "-left-1" : "-right-1",
              )}
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                e.stopPropagation(); // don't also start a "move" on the bar
                handle.listeners?.onPointerDown?.(e);
              }}
            >
              <GripVertical className="h-3 w-3" aria-hidden />
            </span>
          );
        })}
      </ScheduleBar>

      {/* drop ghost: where the bar lands if released now */}
      {active ? (
        <ScheduleBar
          start={active.preview.start}
          end={active.preview.end}
          minWidth={14}
          data-slot="schedule-drop-ghost"
          data-state={invalid ? "invalid" : "valid"}
          className={cn(
            "pointer-events-none top-1/2 z-[7] h-5 -translate-y-1/2 rounded-md border-2 border-dashed",
            invalid ? "border-red-500 bg-red-500/15" : "border-brand-600 bg-brand-500/25",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );
}
