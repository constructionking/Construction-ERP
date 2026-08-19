"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { formatINR } from "@/lib/format/inr";
import { cn } from "@/lib/cn";

interface QueueItem {
  entityId: string;
  siteName: string;
  raisedBy: string;
  createdAt: string;
  neededBy: string | null;
  amountTotal: number;
  justification: string;
  lines: { head: string; amount: number }[];
  version: number;
  state: string;
  actions: {
    action: string;
    reason: string | null;
    approvedAmount: number | null;
    createdAt: string;
  }[];
}

const STATE_TONES: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  pending: "blue",
  resubmitted: "blue",
  approved: "green",
  partially_approved: "green",
  rejected: "red",
  queried: "amber",
  queued: "neutral",
};

export function ApprovalQueue({ items }: { items: QueueItem[] }) {
  const pending = items.filter((i) => ["pending", "resubmitted"].includes(i.state));
  const decided = items.filter((i) => !["pending", "resubmitted"].includes(i.state));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Awaiting your decision ({pending.length})
      </h2>
      {pending.length === 0 ? (
        <EmptyState title="Nothing waiting" hint="New fund requests will appear here" />
      ) : (
        pending.map((item) => <QueueCard key={item.entityId} item={item} decidable />)
      )}

      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Recently decided
      </h2>
      {decided.length === 0 ? (
        <EmptyState title="No decisions yet" />
      ) : (
        decided.slice(0, 10).map((item) => <QueueCard key={item.entityId} item={item} />)
      )}
    </div>
  );
}

function QueueCard({ item, decidable }: { item: QueueItem; decidable?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "approve" | "partial" | "reject" | "query" | "queue">(
    null
  );
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, extra?: { approvedAmount?: number; reason?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requisitions/${item.entityId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      setMode(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{formatINR(item.amountTotal)}</p>
            <p className="text-xs text-slate-500">
              {item.siteName} · raised by {item.raisedBy} ·{" "}
              {new Date(item.createdAt).toLocaleDateString("en-IN")}
              {item.neededBy ? ` · needed by ${item.neededBy}` : ""}
            </p>
          </div>
          <Badge tone={STATE_TONES[item.state] ?? "neutral"}>
            {item.state.replace("_", " ")}
            {item.version > 1 ? ` · v${item.version}` : ""}
          </Badge>
        </div>

        <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">
          {item.lines.map((line, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-slate-600">{line.head}</span>
              <span className="font-medium text-slate-800">{formatINR(line.amount)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-600">{item.justification}</p>

        {item.actions.length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
            {item.actions.map((action, i) => (
              <p key={i} className="text-xs text-slate-500">
                <span className="font-medium">{action.action.replace("_", " ")}</span>
                {action.approvedAmount !== null ? ` ${formatINR(action.approvedAmount)}` : ""}
                {action.reason ? ` — ${action.reason}` : ""} ·{" "}
                {new Date(action.createdAt).toLocaleDateString("en-IN")}
              </p>
            ))}
          </div>
        ) : null}

        {decidable ? (
          <div className="mt-4">
            {mode === null ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="success" disabled={busy} onClick={() => act("approved")}>
                  Approve
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode("partial")}>
                  Partial
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode("query")}>
                  Query
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => act("queued")}>
                  Queue
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => setMode("reject")}>
                  Reject
                </Button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {mode === "partial" ? (
                  <div>
                    <Label>Approved amount (₹)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                ) : null}
                {mode === "reject" || mode === "query" ? (
                  <div>
                    <Label>
                      Reason <span className="text-red-600">*</span>
                    </Label>
                    <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      (mode === "partial" && !amount) ||
                      ((mode === "reject" || mode === "query") && reason.trim().length === 0)
                    }
                    onClick={() =>
                      mode === "partial"
                        ? act("partially_approved", { approvedAmount: Number(amount) })
                        : act(mode === "reject" ? "rejected" : "queried", { reason })
                    }
                    className={cn("flex-1")}
                  >
                    Confirm {mode}
                  </Button>
                </div>
              </div>
            )}
            {error ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
