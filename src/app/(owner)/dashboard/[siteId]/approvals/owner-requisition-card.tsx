"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Textarea } from "@/components/ui";

export function OwnerRequisitionCard({
  entityId,
  state,
  raisedBy,
  createdAt,
  justification,
  lines,
}: {
  entityId: string;
  state: string;
  raisedBy: string;
  createdAt: string;
  justification: string;
  lines: { label: string; value: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "reject" | "query">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, withReason?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requisitions/${entityId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: withReason }),
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
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            {raisedBy} · {new Date(createdAt).toLocaleDateString("en-IN")}
          </p>
          <div className="mt-1 space-y-0.5">
            {lines.map((line, i) => (
              <p key={i} className="text-sm">
                <span className="font-medium text-slate-800">{line.label}</span>{" "}
                <span className="text-slate-600">— {line.value}</span>
              </p>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{justification}</p>
        </div>
        <Badge tone="blue">{state.replace("_", " ")}</Badge>
      </div>
      <div className="mt-3">
        {mode === null ? (
          <div className="flex gap-2">
            <Button variant="success" disabled={busy} onClick={() => act("approved")}>
              Approve
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setMode("query")}>
              Query
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setMode("reject")}>
              Reject
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              rows={2}
              placeholder={`Reason for ${mode} (required)`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setMode(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !reason.trim()}
                onClick={() => act(mode === "reject" ? "rejected" : "queried", reason)}
              >
                Confirm {mode}
              </Button>
            </div>
          </div>
        )}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
