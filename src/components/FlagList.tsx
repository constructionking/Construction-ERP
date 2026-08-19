"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Textarea, EmptyState } from "@/components/ui";

export interface FlagItem {
  id: string;
  rule: string;
  severity: string;
  status: string;
  title: string;
  detail: string;
  createdAt: string;
  reviewNote: string | null;
}

const RULE_LABELS: Record<string, string> = {
  consumption_variance: "Consumption over norm",
  labour_cost_over_benchmark: "Labour cost over benchmark",
  contractor_delay: "Contractor delay",
  scan_variance: "Scan variance",
  receipt_requisition_mismatch: "Receipt exceeds request",
  ai_progress_discrepancy: "Photos vs reported progress",
  quality_inadequate: "Quality issue",
};

export function FlagList({ flags }: { flags: FlagItem[] }) {
  if (flags.length === 0) {
    return <EmptyState title="No flags" hint="The audit engine found nothing to raise" />;
  }
  return (
    <div className="space-y-2">
      {flags.map((flag) => (
        <FlagCard key={flag.id} flag={flag} />
      ))}
    </div>
  );
}

function FlagCard({ flag }: { flag: FlagItem }) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(status: "acknowledged" | "resolved") {
    setBusy(true);
    try {
      await fetch(`/api/flags/${flag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNote: note || undefined }),
      });
      setReviewing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        flag.severity === "critical"
          ? "rounded-lg border border-red-200 bg-red-50/50 px-3 py-2.5"
          : "rounded-lg border border-slate-200 bg-white px-3 py-2.5"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={flag.severity === "critical" ? "red" : "amber"}>
              {RULE_LABELS[flag.rule] ?? flag.rule}
            </Badge>
            {flag.status !== "open" ? <Badge tone="neutral">{flag.status}</Badge> : null}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{flag.title}</p>
          <p className="text-xs text-slate-500">{flag.detail}</p>
          {flag.reviewNote ? (
            <p className="mt-1 text-xs italic text-slate-400">Note: {flag.reviewNote}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-slate-400">
          {new Date(flag.createdAt).toLocaleDateString("en-IN")}
        </span>
      </div>
      {flag.status === "open" ? (
        <div className="mt-2">
          {!reviewing ? (
            <button
              className="text-xs font-medium text-brand-700 hover:underline"
              onClick={() => setReviewing(true)}
            >
              Review…
            </button>
          ) : (
            <div className="space-y-2">
              <Textarea
                rows={2}
                placeholder="Optional note (e.g. spoke to engineer — wastage due to pump breakdown)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => review("acknowledged")}>
                  Acknowledge
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => review("resolved")}>
                  Resolve
                </Button>
                <Button variant="ghost" onClick={() => setReviewing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
