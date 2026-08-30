"use client";

import { useState } from "react";
import { INK, SEQ_BLUE, STATUS } from "./palette";
import { formatINRCompact as formatInr } from "@/lib/format/inr";

// Fund pipeline as one stacked horizontal bar: released → awaiting release →
// with owner → with accounts. One ordinal blue ramp (money moves through ONE
// pipeline — sequential stages, not four identities); 2px surface gaps between
// segments; per-segment hover tooltip; a "% work done" marker gives the
// spend-vs-progress read at a glance.

export interface FundStage {
  key: string;
  label: string;
  amount: number;
}

const STAGE_COLORS = [SEQ_BLUE[4], SEQ_BLUE[3], SEQ_BLUE[2], SEQ_BLUE[1]];

export function FundFlowBar({
  stages,
  workDonePct,
}: {
  stages: FundStage[]; // ordered: released first
  workDonePct: number | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = stages.reduce((s, st) => s + st.amount, 0);
  if (total <= 0) {
    return <p className="text-sm text-slate-500">No fund requests yet.</p>;
  }
  const released = stages[0]?.amount ?? 0;
  const releasedPct = (released / total) * 100;
  const overspending =
    workDonePct !== null && releasedPct > workDonePct + 10 && released > 0;

  return (
    <div>
      <div className="relative">
        <div className="flex h-7 w-full overflow-hidden rounded-lg" style={{ gap: 2, backgroundColor: INK.surface }}>
          {stages.map((st, i) =>
            st.amount > 0 ? (
              <div
                key={st.key}
                className="h-full cursor-default transition-opacity"
                style={{
                  width: `${(st.amount / total) * 100}%`,
                  backgroundColor: STAGE_COLORS[i] ?? SEQ_BLUE[0],
                  opacity: hover && hover !== st.key ? 0.45 : 1,
                }}
                onPointerEnter={() => setHover(st.key)}
                onPointerLeave={() => setHover(null)}
                title={`${st.label}: ${formatInr(st.amount)}`}
              />
            ) : null,
          )}
        </div>
        {workDonePct !== null ? (
          <div
            className="absolute -top-1.5 h-10 w-0.5"
            style={{ left: `${Math.min(100, workDonePct)}%`, backgroundColor: INK.primary }}
            title={`Work done: ${workDonePct.toFixed(0)}%`}
          >
            <span className="absolute -top-4 left-1 whitespace-nowrap text-[10px] font-medium text-slate-700">
              work {workDonePct.toFixed(0)}%
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {stages.map((st, i) => (
          <span key={st.key} className={hover === st.key ? "font-semibold" : undefined}>
            <span
              className="mr-1.5 inline-block h-3 w-3 rounded-sm align-middle"
              style={{ backgroundColor: STAGE_COLORS[i] ?? SEQ_BLUE[0] }}
            />
            <span className="text-slate-500">{st.label}</span>{" "}
            <strong className="text-slate-900">{formatInr(st.amount)}</strong>
          </span>
        ))}
      </div>
      {overspending ? (
        <p className="mt-2 text-xs font-medium" style={{ color: STATUS.critical }}>
          ⚠ Released funds ({releasedPct.toFixed(0)}% of the pipeline) are running ahead of work done
          ({workDonePct!.toFixed(0)}%)
        </p>
      ) : null}
    </div>
  );
}
