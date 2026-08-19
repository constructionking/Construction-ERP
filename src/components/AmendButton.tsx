"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea } from "@/components/ui";

interface AmendField {
  name: string;
  label: string;
  type: "number" | "text";
  value: string;
}

/**
 * Generic reasoned-amendment dialog: shows the amendable fields pre-filled,
 * REQUIRES a reason, and posts to /api/amendments. `carry` holds the
 * unchanged business fields the record type needs for full-payload validation.
 */
export function AmendButton({
  recordType,
  entityId,
  fields,
  carry,
}: {
  recordType: string;
  entityId: string;
  fields: AmendField[];
  carry: Record<string, unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, f.value]))
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data: Record<string, unknown> = { ...carry };
      for (const f of fields) {
        const raw = values[f.name];
        if (f.type === "number") data[f.name] = Number(raw);
        else data[f.name] = raw === "" ? undefined : raw;
      }
      const res = await fetch("/api/amendments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordType, entityId, reason, data }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Amendment rejected");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        onClick={() => setOpen(true)}
      >
        Amend
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Amend record</h3>
        <p className="mt-1 text-xs text-slate-500">
          The original stays on file. Your change creates version history the owner can review.
        </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          {fields.map((f) => (
            <div key={f.name}>
              <Label htmlFor={`amend-${f.name}`}>{f.label}</Label>
              <Input
                id={`amend-${f.name}`}
                type={f.type === "number" ? "number" : "text"}
                step={f.type === "number" ? "0.001" : undefined}
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="amend-reason">
              Reason for the change <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="amend-reason"
              rows={2}
              required
              minLength={5}
              placeholder="e.g. typo — challan shows 14 cum, I entered 12.5"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || reason.trim().length < 5}>
              {busy ? "Saving…" : "Save amendment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
