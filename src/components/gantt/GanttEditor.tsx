"use client";

// Draggable draft-schedule editor for the pre-lock review step. The owner
// drags a bar to MOVE an activity, or its end handles to STRETCH/SHORTEN it;
// the date inputs beside the chart share the same state and update live.
// This edits the DRAFT only — locking still goes through the baseline API,
// and locked baselines remain immutable.

import React, { useRef } from "react";

export type EditorRow =
  | { kind: "heading"; label: string }
  | { kind: "item"; id: string; label: string };

const ROW_H = 30;
const BAR_H = 14;
const LABEL_W = 230;
const HEADER_H = 30;
const HANDLE_W = 7;

const INK = "#1a2233";
const INK_MUTED = "#64748b";
const GRID = "#e2e8f0";
const BAR_FILL = "#7fa8d9";
const BAR_STROKE = "#2a78d6";
const MONSOON_BAND = "rgba(35, 121, 221, 0.07)";

function dayIndex(iso: string, originIso: string): number {
  return Math.round((new Date(iso).getTime() - new Date(originIso).getTime()) / 86_400_000);
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DragState {
  id: string;
  mode: "move" | "start" | "end";
  originClientX: number;
  origStart: string;
  origEnd: string;
  clientPxPerDay: number;
}

export function GanttEditor({
  rows,
  dates,
  onChange,
  monsoonMonths = [6, 7, 8, 9],
  width = 980,
}: {
  rows: EditorRow[];
  dates: Record<string, { start: string; end: string }>;
  onChange: (id: string, start: string, end: string) => void;
  monsoonMonths?: number[];
  width?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const items = rows.filter((r): r is Extract<EditorRow, { kind: "item" }> => r.kind === "item");
  const valid = items.filter((r) => dates[r.id]?.start && dates[r.id]?.end);
  if (valid.length === 0) return null;

  // Generous padding so ordinary drags don't rescale the chart mid-gesture.
  let minIso = dates[valid[0].id].start;
  let maxIso = dates[valid[0].id].end;
  for (const r of valid) {
    if (dates[r.id].start < minIso) minIso = dates[r.id].start;
    if (dates[r.id].end > maxIso) maxIso = dates[r.id].end;
  }
  minIso = addDays(minIso, -14);
  maxIso = addDays(maxIso, 21);
  const totalDays = Math.max(1, dayIndex(maxIso, minIso));
  const plotW = width - LABEL_W - 16;
  const dayW = plotW / totalDays;
  const x = (iso: string) =>
    LABEL_W + Math.min(Math.max(dayIndex(iso, minIso), 0), totalDays) * dayW;
  const height = HEADER_H + rows.length * ROW_H + 8;

  // Month grid (ticks only for months inside the range — see GanttSvg).
  const months: { startIso: string; endIso: string; label: string; monsoon: boolean }[] = [];
  {
    const cursor = new Date(minIso);
    cursor.setUTCDate(1);
    while (cursor.toISOString().slice(0, 10) <= maxIso) {
      const startIso = cursor.toISOString().slice(0, 10);
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      months.push({
        startIso,
        endIso: next.toISOString().slice(0, 10) > maxIso ? maxIso : next.toISOString().slice(0, 10),
        label: new Date(startIso).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        monsoon: monsoonMonths.includes(cursor.getUTCMonth() + 1),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  function beginDrag(e: React.PointerEvent, id: string, mode: DragState["mode"]) {
    const d = dates[id];
    const svg = svgRef.current;
    if (!d || !svg) return;
    const rect = svg.getBoundingClientRect();
    dragRef.current = {
      id,
      mode,
      originClientX: e.clientX,
      origStart: d.start,
      origEnd: d.end,
      clientPxPerDay: (rect.width / width) * dayW,
    };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.clientPxPerDay <= 0) return;
    const delta = Math.round((e.clientX - drag.originClientX) / drag.clientPxPerDay);
    let start = drag.origStart;
    let end = drag.origEnd;
    if (drag.mode === "move") {
      start = addDays(drag.origStart, delta);
      end = addDays(drag.origEnd, delta);
    } else if (drag.mode === "start") {
      start = addDays(drag.origStart, delta);
      if (start > end) start = end;
    } else {
      end = addDays(drag.origEnd, delta);
      if (end < start) end = start;
    }
    const current = dates[drag.id];
    if (current && (current.start !== start || current.end !== end)) {
      onChange(drag.id, start, end);
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (dragRef.current && svgRef.current) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }

  let rowIndex = -1;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="application"
      aria-label="Draft schedule editor: drag bars to move, drag their edges to resize"
      style={{ fontFamily: "inherit", touchAction: "none", userSelect: "none" }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {months.map((month, i) => (
        <g key={i}>
          {month.monsoon ? (
            <rect
              x={x(month.startIso)}
              y={HEADER_H - 4}
              width={Math.max(0, x(month.endIso) - x(month.startIso))}
              height={rows.length * ROW_H + 4}
              fill={MONSOON_BAND}
            />
          ) : null}
          {month.startIso >= minIso ? (
            <line
              x1={x(month.startIso)}
              x2={x(month.startIso)}
              y1={HEADER_H - 4}
              y2={HEADER_H + rows.length * ROW_H}
              stroke={GRID}
              strokeWidth={1}
            />
          ) : null}
          {month.startIso >= minIso && x(month.startIso) + 4 < width - 52 ? (
            <text x={x(month.startIso) + 4} y={HEADER_H - 10} fontSize={11} fill={INK_MUTED}>
              {month.label}
              {month.monsoon ? " ☔" : ""}
            </text>
          ) : null}
        </g>
      ))}

      {rows.map((row, i) => {
        rowIndex += 1;
        const y = HEADER_H + rowIndex * ROW_H;
        if (row.kind === "heading") {
          return (
            <g key={`h-${i}`}>
              <rect x={0} y={y} width={width} height={ROW_H} fill="#eef2f7" />
              <text x={8} y={y + ROW_H / 2 + 4} fontSize={12} fontWeight={700} fill={INK}>
                {row.label.slice(0, 34)}
              </text>
            </g>
          );
        }
        const d = dates[row.id];
        if (!d?.start || !d?.end) return null;
        const barY = y + (ROW_H - BAR_H) / 2;
        const x1 = x(d.start);
        const x2 = x(addDays(d.end, 1));
        const barW = Math.max(dayW, x2 - x1);
        const days = dayIndex(d.end, d.start) + 1;
        return (
          <g key={row.id}>
            <title>{`${row.label}\n${d.start} → ${d.end} (${days}d)\nDrag to move · drag an edge to resize`}</title>
            {rowIndex % 2 === 1 ? (
              // Translucent so the monsoon band stays visible beneath.
              <rect x={0} y={y} width={width} height={ROW_H} fill="rgba(15, 23, 42, 0.025)" />
            ) : null}
            <text x={16} y={y + ROW_H / 2 + 4} fontSize={11} fontWeight={600} fill={INK}>
              {row.label.slice(0, 32)}
            </text>
            {/* bar: drag = move */}
            <rect
              x={x1}
              y={barY}
              width={barW}
              height={BAR_H}
              rx={4}
              fill={BAR_FILL}
              stroke={BAR_STROKE}
              strokeWidth={1}
              style={{ cursor: "grab" }}
              onPointerDown={(e) => beginDrag(e, row.id, "move")}
            />
            {/* duration label when the bar is wide enough */}
            {barW > 42 ? (
              <text
                x={x1 + barW / 2}
                y={barY + BAR_H - 3}
                fontSize={9.5}
                fontWeight={600}
                fill="#0f2f56"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {days}d
              </text>
            ) : null}
            {/* edge handles: drag = resize */}
            <rect
              x={x1 - HANDLE_W / 2}
              y={barY - 2}
              width={HANDLE_W}
              height={BAR_H + 4}
              rx={2}
              fill={BAR_STROKE}
              style={{ cursor: "ew-resize" }}
              onPointerDown={(e) => beginDrag(e, row.id, "start")}
            />
            <rect
              x={x1 + barW - HANDLE_W / 2}
              y={barY - 2}
              width={HANDLE_W}
              height={BAR_H + 4}
              rx={2}
              fill={BAR_STROKE}
              style={{ cursor: "ew-resize" }}
              onPointerDown={(e) => beginDrag(e, row.id, "end")}
            />
          </g>
        );
      })}
    </svg>
  );
}
