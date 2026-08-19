"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, Label } from "@/components/ui";

interface RowError {
  row: number;
  column: string;
  message: string;
}

export function MbUploader({
  siteId,
  reuploadEntityId,
  compact,
}: {
  siteId: string;
  reuploadEntityId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<RowError[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setErrors(null);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      let res: Response;
      if (reuploadEntityId) {
        form.set("reason", reason);
        res = await fetch(`/api/measurement-books/${reuploadEntityId}`, {
          method: "PUT",
          body: form,
        });
      } else {
        form.set("siteId", siteId);
        res = await fetch("/api/measurement-books", { method: "POST", body: form });
      }
      const data = await res.json();
      if (!res.ok) {
        if (data.rowErrors) setErrors(data.rowErrors);
        setMsg(data.error ?? "Upload failed");
        return;
      }
      setMsg(`Parsed ${data.book?.lineCount ?? data.lineCount} lines ✓`);
      setFile(null);
      setOpen(!compact);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (compact && !open) {
    return (
      <button
        className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        onClick={() => setOpen(true)}
      >
        Re-upload
      </button>
    );
  }

  const body = (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {reuploadEntityId ? (
        <div>
          <Label>
            Reason for corrected re-upload <span className="text-red-600">*</span>
          </Label>
          <Textarea
            rows={2}
            required
            value={reason}
            placeholder="e.g. row 7 qty was against the wrong activity code"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      ) : null}
      <div className="flex gap-2">
        {compact ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={busy || !file || (!!reuploadEntityId && reason.trim().length < 5)}
          onClick={submit}
          className="flex-1"
        >
          {busy ? "Parsing…" : reuploadEntityId ? "Upload corrected file" : "Upload & validate"}
        </Button>
      </div>
      {msg ? (
        <p
          className={
            errors
              ? "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              : "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          }
        >
          {msg}
        </p>
      ) : null}
      {errors ? (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-red-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-red-50 text-red-800">
              <tr>
                <th className="px-2 py-1.5 text-left">Row</th>
                <th className="px-2 py-1.5 text-left">Col</th>
                <th className="px-2 py-1.5 text-left">Problem</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-t border-red-100">
                  <td className="px-2 py-1.5">{e.row}</td>
                  <td className="px-2 py-1.5">{e.column}</td>
                  <td className="px-2 py-1.5">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
        <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
          <h3 className="mb-3 text-base font-semibold text-slate-900">Corrected re-upload</h3>
          {body}
        </div>
      </div>
    );
  }
  return body;
}
