import { Card, CardContent } from "@/components/ui";
import { Sparkline } from "./Sparkline";
import { STATUS, INK } from "./palette";

// KPI card contract (dataviz stat-tile): label · value · delta vs a named
// previous period · RAG dot · trend sparkline. Never a bare big number.

export type Rag = "good" | "warning" | "serious" | "critical" | null;

const RAG_COLOR: Record<Exclude<Rag, null>, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  serious: STATUS.serious,
  critical: STATUS.critical,
};
const RAG_LABEL: Record<Exclude<Rag, null>, string> = {
  good: "on track",
  warning: "watch",
  serious: "at risk",
  critical: "critical",
};

export function KpiCard({
  label,
  value,
  delta,
  deltaGood,
  deltaLabel = "vs last week",
  sub,
  rag,
  trend,
}: {
  label: string;
  value: string;
  delta?: number | null; // signed change vs previous period (same unit as value implies)
  deltaGood?: boolean; // is this delta's direction good?
  deltaLabel?: string;
  sub?: string;
  rag?: Rag;
  trend?: number[];
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-1.5">
          {rag ? (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: RAG_COLOR[rag] }}
              title={RAG_LABEL[rag]}
              aria-label={RAG_LABEL[rag]}
            />
          ) : null}
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-2xl font-semibold text-slate-900">{value}</p>
            {delta !== undefined && delta !== null ? (
              <p
                className="mt-0.5 text-xs font-medium"
                style={{ color: (delta >= 0) === (deltaGood ?? true) ? INK.deltaGood : STATUS.critical }}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("en-IN", { maximumFractionDigits: 1 })}{" "}
                <span className="font-normal text-slate-400">{deltaLabel}</span>
              </p>
            ) : sub ? (
              <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
            ) : null}
          </div>
          {trend && trend.length >= 2 ? (
            <div className="shrink-0 pb-1">
              <Sparkline points={trend} />
            </div>
          ) : null}
        </div>
        {delta !== undefined && delta !== null && sub ? (
          <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
