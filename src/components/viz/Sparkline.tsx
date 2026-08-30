import { INK, SERIES } from "./palette";

// 12-point-ish sparkline for KPI cards. Server-renderable, no axes, no hover
// (the KPI card's value + delta carry the numbers; the trend is the message).
export function Sparkline({
  points,
  width = 96,
  height = 28,
  color = SERIES.s1,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* end marker with a surface ring so it reads over the line */}
      <circle cx={lastX} cy={lastY} r={4.5} fill={INK.surface} />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  );
}
