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
  mode = "material",
}: {
  entityId: string;
  state: string;
  raisedBy: string;
  createdAt: string;
  justification: string;
  lines: { label: string; value: string }[];
  /** material: direct owner decision · fundFinal: final approval after accounts */
  mode?: "material" | "fundFinal";
}) {
  const router = useRouter();
  const [uiMode, setUiMode] = useState<null | "reject" | "query">(null);
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
      setUiMode(null);
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
        {uiMode === null ? (
          <div className="flex gap-2">
            <Button
              variant="success"
              disabled={busy}
              onClick={() => act(mode === "fundFinal" ? "owner_approved" : "approved")}
            >
              {mode === "fundFinal" ? "✓ Final approve — release to accounts" : "Approve"}
            </Button>
            {mode === "material" ? (
              <Button variant="secondary" disabled={busy} onClick={() => setUiMode("query")}>
                Query
              </Button>
            ) : null}
            <Button variant="danger" disabled={busy} onClick={() => setUiMode("reject")}>
              Reject
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              rows={2}
              placeholder={`Reason for ${uiMode} (required)`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setUiMode(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !reason.trim()}
                onClick={() =>
                  act(
                    uiMode === "reject"
                      ? mode === "fundFinal"
                        ? "owner_rejected"
                        : "rejected"
                      : "queried",
                    reason
                  )
                }
              >
                Confirm {uiMode}
              </Button>
            </div>
          </div>
        )}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
