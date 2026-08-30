"use client";

import { useState } from "react";
import { INK, SERIES } from "./palette";

// Daily manpower: one bar per day (headcount from day-rate labour entries).
// Single series → no legend (the card title names it); per-bar hover tooltip;
// bars ≤24px with a 4px rounded cap, square at the baseline, 2px gaps.

export interface ManpowerDay {
  date: string; // yyyy-mm-dd
  workers: number;
}

const W = 720;
const H = 160;
const PAD = { l: 34, r: 8, t: 10, b: 24 };

export function ManpowerChart({ days }: { days: ManpowerDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) {
    return <p className="text-sm text-slate-500">No day-rate labour recorded in this period.</p>;
  }
  const max = Math.max(...days.map((d) => d.workers), 1);
  const yTop = Math.ceil(max / 10) * 10 || 10;
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / days.length;
  const barW = Math.min(24, Math.max(3, slot - 2));
  const y = (v: number) => H - PAD.b - (v / yTop) * (H - PAD.t - PAD.b);
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Daily manpower on site"
        onPointerLeave={() => setHover(null)}
      >
        {[0, yTop / 2, yTop].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={INK.grid} strokeWidth={1} />
            <text x={PAD.l - 5} y={y(v) + 3.5} fontSize={10} fill={INK.muted} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = PAD.l + i * slot + slot / 2;
          const barH = Math.max(0, y(0) - y(d.workers));
          return (
            <g key={d.date} onPointerEnter={() => setHover(i)}>
              {/* hit target wider than the mark */}
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {d.workers > 0 ? (
                <path
                  // Rounded cap (4px) at the data end, square at the baseline.
                  d={`M${cx - barW / 2},${y(0)} L${cx - barW / 2},${y(d.workers) + 4} Q${cx - barW / 2},${y(d.workers)} ${cx - barW / 2 + 4},${y(d.workers)} L${cx + barW / 2 - 4},${y(d.workers)} Q${cx + barW / 2},${y(d.workers)} ${cx + barW / 2},${y(d.workers) + 4} L${cx + barW / 2},${y(0)} Z`}
                  fill={SERIES.s1}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
              ) : null}
              {(i === 0 || new Date(d.date).getDate() === 1 || days.length <= 14) && days.length <= 45 ? (
                <text x={cx} y={H - PAD.b + 13} fontSize={9} fill={INK.muted} textAnchor="middle">
                  {new Date(d.date).getDate()}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min(80, ((PAD.l + (hover! + 0.5) * slot) / W) * 100)}%` }}
        >
          <strong className="text-slate-900">{h.workers} workers</strong>{" "}
          <span className="text-slate-500">
            {new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
