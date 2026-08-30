"use client";

import { useRef, useState } from "react";
import { INK, MONSOON_BAND, SERIES } from "./palette";

// S-curve: planned vs actual cumulative progress % over time. Planned comes
// from the locked baseline (duration-weighted), actual from submitted
// progress entries. Crosshair + one tooltip listing BOTH series at the
// hovered date, monsoon months shaded, today rule. Two series → legend.

export interface SCurvePoint {
  date: string; // yyyy-mm-dd (weekly)
  planned: number; // cumulative %
  actual: number | null; // null past today
}

const W = 720;
const H = 260;
const PAD = { l: 40, r: 16, t: 14, b: 28 };

export function SCurve({
  points,
  todayIso,
  monsoonMonths = [6, 7, 8, 9],
}: {
  points: SCurvePoint[];
  todayIso: string;
  monsoonMonths?: number[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <p className="text-sm text-slate-500">Lock a schedule baseline to see the S-curve.</p>;
  }

  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (pct: number) => H - PAD.b - (pct / 100) * (H - PAD.t - PAD.b);

  const plannedPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.planned).toFixed(1)}`)
    .join(" ");
  const actualPts = points.filter((p) => p.actual !== null);
  const actualPath = actualPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(points.indexOf(p)).toFixed(1)},${y(p.actual!).toFixed(1)}`)
    .join(" ");

  // Monsoon bands: contiguous runs of monsoon-month points.
  const bands: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const m = Number(points[i].date.slice(5, 7));
    if (!monsoonMonths.includes(m)) continue;
    const last = bands[bands.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else bands.push({ from: i, to: i });
  }

  const todayIdx = points.findIndex((p) => p.date >= todayIso);
  const lastActual = actualPts[actualPts.length - 1];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  }

  const h = hover !== null ? points[hover] : null;
  const gapPp = h && h.actual !== null ? h.actual - h.planned : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="S-curve: planned versus actual cumulative progress"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: "none" }}
      >
        {bands.map((b, i) => (
          <rect
            key={i}
            x={x(b.from)}
            y={PAD.t}
            width={Math.max(0, x(Math.min(points.length - 1, b.to + 1)) - x(b.from))}
            height={H - PAD.t - PAD.b}
            fill={MONSOON_BAND}
          />
        ))}
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(pct)} y2={y(pct)} stroke={INK.grid} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(pct) + 3.5} fontSize={10} fill={INK.muted} textAnchor="end">
              {pct}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          p.date.slice(8, 10) <= "07" && (i === 0 || points[i - 1].date.slice(5, 7) !== p.date.slice(5, 7)) ? (
            <text key={p.date} x={x(i)} y={H - PAD.b + 14} fontSize={10} fill={INK.muted}>
              {new Date(p.date).toLocaleDateString("en-IN", { month: "short" })}
            </text>
          ) : null,
        )}

        {todayIdx >= 0 ? (
          <line
            x1={x(todayIdx)}
            x2={x(todayIdx)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke={INK.muted}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        <path d={plannedPath} fill="none" stroke={SERIES.s1} strokeWidth={2} strokeLinejoin="round" />
        <path d={actualPath} fill="none" stroke={SERIES.s2} strokeWidth={2} strokeLinejoin="round" />
        {lastActual ? (
          <>
            <circle cx={x(points.indexOf(lastActual))} cy={y(lastActual.actual!)} r={5.5} fill={INK.surface} />
            <circle cx={x(points.indexOf(lastActual))} cy={y(lastActual.actual!)} r={4} fill={SERIES.s2} />
            <text
              x={x(points.indexOf(lastActual)) + 8}
              y={y(lastActual.actual!) + 4}
              fontSize={11}
              fontWeight={600}
              fill={INK.primary}
            >
              {lastActual.actual!.toFixed(0)}%
            </text>
          </>
        ) : null}

        {h !== null && hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke={INK.baseline} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.planned)} r={4.5} fill={INK.surface} />
            <circle cx={x(hover)} cy={y(h.planned)} r={3} fill={SERIES.s1} />
            {h.actual !== null ? (
              <>
                <circle cx={x(hover)} cy={y(h.actual)} r={4.5} fill={INK.surface} />
                <circle cx={x(hover)} cy={y(h.actual)} r={3} fill={SERIES.s2} />
              </>
            ) : null}
          </g>
        ) : null}
      </svg>

      {h !== null && hover !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
          style={{ left: `${Math.min(78, (x(hover) / W) * 100)}%` }}
        >
          <p className="font-medium text-slate-500">
            {new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
          </p>
          <p className="mt-1">
            <span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: SERIES.s1 }} />
            <strong className="text-slate-900">{h.planned.toFixed(1)}%</strong>{" "}
            <span className="text-slate-500">planned</span>
          </p>
          {h.actual !== null ? (
            <p>
              <span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: SERIES.s2 }} />
              <strong className="text-slate-900">{h.actual.toFixed(1)}%</strong>{" "}
              <span className="text-slate-500">actual</span>
            </p>
          ) : null}
          {gapPp !== null ? (
            <p className="mt-1 font-medium" style={{ color: gapPp >= 0 ? INK.deltaGood : "#d03b3b" }}>
              {gapPp >= 0 ? "ahead" : "behind"} by {Math.abs(gapPp).toFixed(1)} pp
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
        <span>
          <span className="mr-1.5 inline-block h-0.5 w-4 align-middle" style={{ backgroundColor: SERIES.s1 }} />
          Planned (baseline)
        </span>
        <span>
          <span className="mr-1.5 inline-block h-0.5 w-4 align-middle" style={{ backgroundColor: SERIES.s2 }} />
          Actual
        </span>
        <span>
          <span
            className="mr-1.5 inline-block h-3 w-3 border align-middle"
            style={{ backgroundColor: MONSOON_BAND, borderColor: INK.grid }}
          />
          Monsoon
        </span>
      </div>
    </div>
  );
}
