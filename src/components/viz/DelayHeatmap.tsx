"use client";

import { useState } from "react";
import { divergingColor, INK, DIVERGING } from "./palette";

// Delay heatmap: main activities × weeks; each cell = actual − planned
// progress (percentage points) for that structure at that week's end.
// Polarity → DIVERGING blue (ahead) ↔ red (behind) with a neutral midpoint.
// Cell click pins a detail line naming the trailing work items.

export interface HeatCell {
  week: string; // yyyy-mm-dd (week start)
  deltaPp: number | null; // null = structure not yet started/planned that week
  worstItems: string[]; // trailing work items behind plan in that week
}

export interface HeatRow {
  structure: string;
  cells: HeatCell[];
}

export function DelayHeatmap({ rows }: { rows: HeatRow[] }) {
  const [pinned, setPinned] = useState<{ row: number; col: number } | null>(null);

  if (rows.length === 0 || rows[0].cells.length === 0) {
    return <p className="text-sm text-slate-500">Lock a baseline and record progress to see delay by main activity.</p>;
  }
  const weeks = rows[0].cells.map((c) => c.week);
  const pinnedCell = pinned ? rows[pinned.row]?.cells[pinned.col] : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="pr-2 text-left text-[10px] font-medium text-slate-400" />
              {weeks.map((w, i) =>
                i % 2 === 0 ? (
                  <th key={w} className="text-[9px] font-normal text-slate-400" style={{ minWidth: 22 }}>
                    {new Date(w).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </th>
                ) : (
                  <th key={w} style={{ minWidth: 22 }} />
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.structure}>
                <td className="max-w-40 truncate pr-2 text-xs font-medium text-slate-700">{row.structure}</td>
                {row.cells.map((cell, ci) => (
                  <td key={cell.week} style={{ padding: 0 }}>
                    <button
                      type="button"
                      className="block h-5 w-full min-w-[22px] rounded-[3px] outline-offset-1"
                      style={{
                        backgroundColor: cell.deltaPp === null ? "#f4f4f2" : divergingColor(cell.deltaPp),
                        outline:
                          pinned?.row === ri && pinned?.col === ci ? `2px solid ${INK.primary}` : undefined,
                      }}
                      title={
                        cell.deltaPp === null
                          ? `${row.structure} — not planned this week`
                          : `${row.structure} · week of ${cell.week}\n${cell.deltaPp >= 0 ? "ahead" : "behind"} by ${Math.abs(cell.deltaPp).toFixed(1)} pp`
                      }
                      onClick={() =>
                        setPinned(pinned?.row === ri && pinned?.col === ci ? null : { row: ri, col: ci })
                      }
                      aria-label={`${row.structure}, week of ${cell.week}: ${
                        cell.deltaPp === null ? "not planned" : `${cell.deltaPp.toFixed(1)} percentage points vs plan`
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pinned && pinnedCell ? (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <p className="font-medium text-slate-800">
            {rows[pinned.row].structure} · week of{" "}
            {new Date(pinnedCell.week).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            {pinnedCell.deltaPp !== null ? (
              <span style={{ color: pinnedCell.deltaPp >= 0 ? INK.deltaGood : "#d03b3b" }}>
                {" "}
                — {pinnedCell.deltaPp >= 0 ? "ahead" : "behind"} by {Math.abs(pinnedCell.deltaPp).toFixed(1)} pp
              </span>
            ) : null}
          </p>
          {pinnedCell.worstItems.length > 0 ? (
            <p className="mt-1 text-slate-500">Trailing: {pinnedCell.worstItems.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span>behind</span>
        {[...DIVERGING.warmArm].reverse().map((c) => (
          <span key={c} className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: c }} />
        ))}
        <span className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: DIVERGING.mid }} />
        {DIVERGING.coolArm.map((c) => (
          <span key={c} className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: c }} />
        ))}
        <span>ahead</span>
      </div>
    </div>
  );
}
