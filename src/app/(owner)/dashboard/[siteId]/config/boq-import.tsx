"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/cn";

// BOQ Excel import: upload → the server parses & classifies (nothing is
// saved) → the owner reviews every detected item here — correcting names,
// quantities, units, categories — → one Approve creates/updates everything.
// Same house pattern as the Gantt schedule review: client-side staging only.

const CATEGORIES = [
  "earthwork", "concreting", "reinforcement", "shuttering", "masonry",
  "plaster", "waterproofing", "flooring", "finishes", "external", "general",
];
const UNITS = ["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"];
const CODE_RE = /^[A-Z0-9._-]{1,20}$/i;

interface PreviewItem {
  code: string;
  name: string;
  category: string;
  qty: number | null;
  unit: string | null;
  unitRaw: string | null;
  sectionPath: string[];
  sheetName: string;
  rowNumber: number;
  exists: boolean;
  duplicateInFile: boolean;
  aiConfidence: number | null;
}

interface EditableRow {
  key: string;
  include: boolean;
  code: string;
  name: string;
  qty: string;
  unit: string; // "" when unmapped → amber row, blocks approval
  category: string;
  exists: boolean;
  duplicateInFile: boolean;
  unitRaw: string | null;
  sheetName: string;
  rowNumber: number;
}

type Phase = "idle" | "uploading" | "review" | "committing";

function rowProblem(r: EditableRow): string | null {
  if (!r.include) return null;
  if (!CODE_RE.test(r.code)) return "bad code";
  if (r.name.trim().length < 2) return "name too short";
  const qty = Number(r.qty);
  if (!Number.isFinite(qty) || qty <= 0) return "invalid qty";
  if (!r.unit) return "pick a unit";
  return null;
}

export function BoqImport({ siteId }: { siteId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [chainSequence, setChainSequence] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiUsed, setAiUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPhase("uploading");
    setError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/sites/${siteId}/boq-import`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not read this file");
        setWarnings(data.warnings ?? []);
        setPhase("idle");
        return;
      }
      setRows(
        (data.items as PreviewItem[]).map((it) => ({
          key: `${it.sheetName}:${it.rowNumber}`,
          include: !it.duplicateInFile,
          code: it.code,
          name: it.name,
          qty: it.qty !== null ? String(it.qty) : "",
          unit: it.unit ?? "",
          category: it.category,
          exists: it.exists,
          duplicateInFile: it.duplicateInFile,
          unitRaw: it.unitRaw,
          sheetName: it.sheetName,
          rowNumber: it.rowNumber,
        })),
      );
      setWarnings(data.warnings ?? []);
      setAiUsed(Boolean(data.aiUsed));
      setPhase("review");
    } catch {
      setError("Upload failed — check your connection and try again");
      setPhase("idle");
    }
  }

  function patch(key: string, changes: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...changes } : r)));
  }

  async function approve() {
    const included = rows.filter((r) => r.include);
    setPhase("committing");
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/activities/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainSequence,
          items: included.map((r) => ({
            code: r.code.trim(),
            name: r.name.trim(),
            category: r.category,
            boqQty: Number(r.qty),
            unit: r.unit,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        setPhase("review");
        return;
      }
      setSummary(
        `${data.created} created, ${data.updated} updated` +
          (data.dependenciesCreated ? `, ${data.dependenciesCreated} dependencies linked` : "") +
          (data.skippedDeps ? ` (${data.skippedDeps} links skipped to avoid loops)` : ""),
      );
      setRows([]);
      setPhase("idle");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setError("Import failed — check your connection and try again");
      setPhase("review");
    }
  }

  const included = rows.filter((r) => r.include);
  const blocking = included.filter((r) => rowProblem(r) !== null);
  const groups = [...new Set(rows.map((r) => r.category))];
  const sheetNames = [...new Set(rows.map((r) => r.sheetName))];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Import BOQ from Excel</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Upload the BOQ .xlsx — the app detects the line items, groups them by work type and
          pre-fills everything. Nothing is saved until you approve the list below.
        </p>
      </CardHeader>
      <CardContent>
        {phase === "idle" || phase === "uploading" ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm"
            />
            <Button onClick={upload} disabled={phase === "uploading"}>
              {phase === "uploading" ? "Reading BOQ…" : "Upload & detect items"}
            </Button>
            {summary ? <Badge tone="green">{summary}</Badge> : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-amber-700">
            {warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        ) : null}

        {phase === "review" || phase === "committing" ? (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="blue">{included.length} of {rows.length} items selected</Badge>
              {aiUsed ? <Badge tone="neutral">AI-assisted grouping — review each row</Badge> : null}
            </div>

            {sheetNames.length > 1 ? (
              // Workbooks often carry design VARIANTS as separate sheets —
              // let the owner keep one variant with a single click.
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-slate-500">Sheets:</span>
                {sheetNames.map((s) => {
                  const anyOn = rows.some((r) => r.sheetName === s && r.include);
                  return (
                    <label
                      key={s}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                        anyOn
                          ? "border-brand-300 bg-brand-50 text-brand-800"
                          : "border-slate-300 bg-slate-50 text-slate-400",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={anyOn}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.sheetName === s ? { ...r, include: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                      {s} ({rows.filter((r) => r.sheetName === s).length})
                    </label>
                  );
                })}
              </div>
            ) : null}

            {groups.map((cat) => {
              const groupRows = rows.filter((r) => r.category === cat);
              const subtotals = new Map<string, number>();
              for (const r of groupRows) {
                if (!r.include) continue;
                const qty = Number(r.qty);
                if (!r.unit || !Number.isFinite(qty)) continue;
                subtotals.set(r.unit, (subtotals.get(r.unit) ?? 0) + qty);
              }
              return (
                <div key={cat} className="rounded-lg border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="text-sm font-semibold capitalize text-slate-800">{cat}</span>
                    <span className="text-xs text-slate-500">
                      {[...subtotals.entries()]
                        .map(([u, q]) => `${q.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${u}`)
                        .join(" · ") || "—"}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {groupRows.map((r) => {
                      const problem = rowProblem(r);
                      return (
                        <div
                          key={r.key}
                          className={cn(
                            "grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-[auto_7rem_1fr_6rem_6rem_8rem]",
                            problem ? "bg-amber-50" : undefined,
                            !r.include ? "opacity-50" : undefined,
                          )}
                        >
                          <label className="flex items-center gap-2 sm:col-span-1">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => patch(r.key, { include: e.target.checked })}
                            />
                            <span className="text-xs text-slate-400">
                              {r.sheetName} r{r.rowNumber}
                            </span>
                          </label>
                          <Input
                            value={r.code}
                            onChange={(e) => patch(r.key, { code: e.target.value })}
                            className="py-1.5 text-xs"
                            aria-label="Code"
                          />
                          <div>
                            <Input
                              value={r.name}
                              onChange={(e) => patch(r.key, { name: e.target.value })}
                              className="py-1.5 text-xs"
                              aria-label="Work item name"
                            />
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.exists ? <Badge tone="amber">exists — will update</Badge> : null}
                              {r.duplicateInFile ? <Badge tone="red">duplicate in file</Badge> : null}
                              {!r.unit && r.unitRaw ? (
                                <Badge tone="amber">unit “{r.unitRaw}” not recognized — pick one</Badge>
                              ) : null}
                            </div>
                          </div>
                          <Input
                            value={r.qty}
                            onChange={(e) => patch(r.key, { qty: e.target.value })}
                            inputMode="decimal"
                            className="py-1.5 text-right text-xs"
                            aria-label="Quantity"
                          />
                          <Select
                            value={r.unit}
                            onChange={(e) => patch(r.key, { unit: e.target.value })}
                            className="py-1.5 text-xs"
                            aria-label="Unit"
                          >
                            <option value="">unit…</option>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </Select>
                          <Select
                            value={r.category}
                            onChange={(e) => patch(r.key, { category: e.target.value })}
                            className="py-1.5 text-xs"
                            aria-label="Category"
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={chainSequence}
                  onChange={(e) => setChainSequence(e.target.checked)}
                />
                Chain in sequence (each item starts after the previous finishes)
              </label>
              <div className="ml-auto flex items-center gap-2">
                {blocking.length > 0 ? (
                  <span className="text-xs text-amber-700">
                    {blocking.length} row{blocking.length > 1 ? "s" : ""} need fixing
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRows([]);
                    setPhase("idle");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={approve}
                  disabled={phase === "committing" || included.length === 0 || blocking.length > 0}
                >
                  {phase === "committing"
                    ? "Creating…"
                    : `Approve & create ${included.length} item${included.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
