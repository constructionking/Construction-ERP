// Custom SVG Gantt: baseline bar vs actual-progress fill per activity, dashed
// forecast extension, monsoon-month background bands, delay badges.
// Server-renderable; native <title> tooltips on every mark.

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

const ROW_H = 34;
const BAR_H = 12;
const ACTUAL_H = 6;
const LABEL_W = 210;
const HEADER_H = 34;
const LEGEND_H = 30;

const INK = "#1a2233";
const INK_MUTED = "#64748b";
const GRID = "#e2e8f0";
const BASELINE_FILL = "#cbd5e1";
const ACTUAL_FILL = "#2379dd";
const DELAY_WARN = "#d97706";
const DELAY_CRITICAL = "#dc2626";
const MONSOON_BAND = "rgba(35, 121, 221, 0.07)";

function dayIndex(iso: string, originIso: string): number {
  return Math.round((new Date(iso).getTime() - new Date(originIso).getTime()) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function GanttSvg({
  rows,
  todayIso,
  monsoonMonths = [6, 7, 8, 9],
  width = 980,
  onRowClick,
}: {
  rows: GanttRow[];
  todayIso: string;
  monsoonMonths?: number[];
  width?: number;
  onRowClick?: (code: string) => void; // parent expand/collapse (client wrapper)
}) {
  if (rows.length === 0) return null;

  // Chart range: min planned start → max(planned end, forecast end, today) + pad
  let minIso = rows[0].plannedStart;
  let maxIso = todayIso;
  for (const row of rows) {
    if (row.plannedStart < minIso) minIso = row.plannedStart;
    if (row.plannedEnd > maxIso) maxIso = row.plannedEnd;
    if (row.forecastEnd && row.forecastEnd > maxIso) maxIso = row.forecastEnd;
  }
  minIso = addDays(minIso, -3);
  maxIso = addDays(maxIso, 7);
  const totalDays = Math.max(1, dayIndex(maxIso, minIso));

  const plotW = width - LABEL_W - 16;
  const x = (iso: string) =>
    LABEL_W + Math.min(Math.max(dayIndex(iso, minIso), 0), totalDays) * (plotW / totalDays);
  const height = HEADER_H + rows.length * ROW_H + LEGEND_H;

  // Month ticks + monsoon bands
  const months: { startIso: string; endIso: string; label: string; monsoon: boolean }[] = [];
  {
    const cursor = new Date(minIso);
    cursor.setUTCDate(1);
    while (cursor.toISOString().slice(0, 10) <= maxIso) {
      const startIso = cursor.toISOString().slice(0, 10);
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const endIso = next.toISOString().slice(0, 10);
      months.push({
        startIso,
        endIso: endIso > maxIso ? maxIso : endIso,
        label: monthLabel(startIso),
        monsoon: monsoonMonths.includes(cursor.getUTCMonth() + 1),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Gantt chart: planned baseline versus actual progress per activity"
      style={{ fontFamily: "inherit" }}
    >
      {/* monsoon bands + month grid */}
      {months.map((month, i) => (
        <g key={i}>
          {month.monsoon ? (
            <rect
              x={x(month.startIso)}
              y={HEADER_H - 6}
              width={Math.max(0, x(month.endIso) - x(month.startIso))}
              height={rows.length * ROW_H + 6}
              fill={MONSOON_BAND}
            />
          ) : null}
          <line
            x1={x(month.startIso)}
            x2={x(month.startIso)}
            y1={HEADER_H - 6}
            y2={HEADER_H + rows.length * ROW_H}
            stroke={GRID}
            strokeWidth={1}
          />
          <text x={x(month.startIso) + 4} y={HEADER_H - 12} fontSize={11} fill={INK_MUTED}>
            {month.label}
            {month.monsoon ? " ☔" : ""}
          </text>
        </g>
      ))}

      {/* today line */}
      <line
        x1={x(todayIso)}
        x2={x(todayIso)}
        y1={HEADER_H - 6}
        y2={HEADER_H + rows.length * ROW_H}
        stroke={INK_MUTED}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text x={x(todayIso) + 3} y={HEADER_H + rows.length * ROW_H - 4} fontSize={10} fill={INK_MUTED}>
        today
      </text>

      {/* rows */}
      {rows.map((row, i) => {
        const y = HEADER_H + i * ROW_H;
        const barY = y + (ROW_H - BAR_H) / 2;
        const x1 = x(row.plannedStart);
        const x2 = x(addDays(row.plannedEnd, 1));
        const barW = Math.max(2, x2 - x1);
        const actualW = Math.max(0, (barW * Math.min(row.progressPct, 100)) / 100);
        const delayed = row.slipPct !== null && row.slipPct > 10;
        const delayColor =
          row.slipPct !== null && row.slipPct > 25 ? DELAY_CRITICAL : DELAY_WARN;

        const indent = (row.level ?? 0) * 16;
        return (
          <g
            key={row.code}
            onClick={row.isParent && onRowClick ? () => onRowClick(row.code) : undefined}
            style={row.isParent && onRowClick ? { cursor: "pointer" } : undefined}
          >
            <title>
              {`${row.code} ${row.name}\nPlanned ${row.plannedStart} → ${row.plannedEnd}\nProgress ${row.progressPct.toFixed(0)}%` +
                (row.forecastEnd ? `\nForecast finish ${row.forecastEnd}` : "") +
                (row.slipPct !== null && row.slipPct > 0 ? `\nSlip ${row.slipPct.toFixed(0)}%` : "") +
                (row.isParent ? `\n${row.childCount ?? 0} items — click to ${row.expanded ? "collapse" : "expand"}` : "")}
            </title>
            {row.isParent ? (
              <rect x={0} y={y} width={width} height={ROW_H} fill="#eef2f7" />
            ) : i % 2 === 1 ? (
              <rect x={0} y={y} width={width} height={ROW_H} fill="#f8fafc" />
            ) : null}
            <text
              x={8 + indent}
              y={y + ROW_H / 2 - 2}
              fontSize={12}
              fontWeight={row.isParent ? 700 : 600}
              fill={INK}
            >
              {row.isParent ? `${row.expanded ? "▾" : "▸"} ` : ""}
              {row.isParent ? row.name.slice(0, 30) : row.code}
            </text>
            <text x={8 + indent} y={y + ROW_H / 2 + 11} fontSize={10} fill={INK_MUTED}>
              {row.isParent
                ? `${row.childCount ?? 0} items · ${row.progressPct.toFixed(0)}% done`
                : (row.name.length > 34 ? row.name.slice(0, 33) + "…" : row.name) +
                  (row.contractorName ? ` · ${row.contractorName}` : "")}
            </text>

            {/* baseline bar (parents: derived span of children, outlined) */}
            <rect
              x={x1}
              y={row.isParent ? barY - 2 : barY}
              width={barW}
              height={row.isParent ? BAR_H + 4 : BAR_H}
              rx={4}
              fill={row.isParent ? "#aab8cc" : BASELINE_FILL}
              stroke={row.isParent ? INK_MUTED : "none"}
              strokeWidth={row.isParent ? 1 : 0}
            />
            {/* actual progress fill */}
            {actualW > 0 ? (
              <rect
                x={x1}
                y={barY + (BAR_H - ACTUAL_H) / 2}
                width={actualW}
                height={ACTUAL_H}
                rx={3}
                fill={ACTUAL_FILL}
              />
            ) : null}
            {/* forecast extension past planned end */}
            {row.forecastEnd && row.forecastEnd > row.plannedEnd ? (
              <line
                x1={x2}
                x2={x(row.forecastEnd)}
                y1={barY + BAR_H / 2}
                y2={barY + BAR_H / 2}
                stroke={delayed ? delayColor : INK_MUTED}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            ) : null}
            {/* delay badge */}
            {delayed ? (
              <g>
                <rect
                  x={x(row.forecastEnd ?? row.plannedEnd) + 4}
                  y={barY - 2}
                  width={44}
                  height={16}
                  rx={8}
                  fill={delayColor}
                />
                <text
                  x={x(row.forecastEnd ?? row.plannedEnd) + 26}
                  y={barY + 10}
                  fontSize={10}
                  fontWeight={600}
                  fill="#ffffff"
                  textAnchor="middle"
                >
                  +{row.slipPct!.toFixed(0)}%
                </text>
              </g>
            ) : null}
          </g>
        );
      })}

      {/* legend */}
      <g transform={`translate(${LABEL_W}, ${HEADER_H + rows.length * ROW_H + 18})`} fontSize={11}>
        <rect x={0} y={-9} width={22} height={10} rx={4} fill={BASELINE_FILL} />
        <text x={28} y={0} fill={INK_MUTED}>
          Planned (locked baseline)
        </text>
        <rect x={190} y={-7} width={22} height={6} rx={3} fill={ACTUAL_FILL} />
        <text x={218} y={0} fill={INK_MUTED}>
          Actual progress
        </text>
        <line x1={340} x2={362} y1={-4} y2={-4} stroke={DELAY_WARN} strokeWidth={2} strokeDasharray="4 3" />
        <text x={368} y={0} fill={INK_MUTED}>
          Forecast slip
        </text>
        <rect x={470} y={-11} width={14} height={14} fill={MONSOON_BAND} stroke={GRID} />
        <text x={490} y={0} fill={INK_MUTED}>
          Monsoon months
        </text>
      </g>
    </svg>
  );
}
