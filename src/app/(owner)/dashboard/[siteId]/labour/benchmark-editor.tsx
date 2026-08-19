"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";

interface WorkTypeOpt {
  id: string;
  name: string;
  defaultUnit: string;
}
interface BenchmarkRow {
  id: string;
  workTypeId: string;
  unit: string;
  cost: number;
  effectiveFrom: string;
}

const UNITS = ["MTR", "CUM", "SQM"];

// Owner sets the per-mtr / per-CUM / per-sqm cost each work type SHOULD cost;
// the audit engine flags departmental labour running above it.
export function BenchmarkEditor({
  workTypes,
  benchmarks,
}: {
  workTypes: WorkTypeOpt[];
  benchmarks: BenchmarkRow[];
}) {
  const router = useRouter();
  const [workTypeId, setWorkTypeId] = useState("");
  const [unit, setUnit] = useState("CUM");
  const [cost, setCost] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workTypeById = new Map(workTypes.map((w) => [w.id, w]));
  const currentByType = new Map<string, BenchmarkRow>();
  for (const benchmark of benchmarks) {
    const key = `${benchmark.workTypeId}:${benchmark.unit}`;
    if (!currentByType.has(key)) currentByType.set(key, benchmark); // list is newest-first
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workTypeId,
          unit,
          benchmarkCostPerUnit: Number(cost),
          effectiveFrom,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save");
        return;
      }
      setCost("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost benchmarks (₹ per unit of work)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentByType.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...currentByType.values()].map((benchmark) => (
              <span
                key={benchmark.id}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
              >
                {workTypeById.get(benchmark.workTypeId)?.name ?? "Work"}: ₹
                {benchmark.cost.toLocaleString("en-IN")}/{benchmark.unit.toLowerCase()}
                <span className="text-slate-400"> since {benchmark.effectiveFrom}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No benchmarks yet — labour cost audits activate once you set them.
          </p>
        )}

        <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="col-span-2">
            <Label>Work type</Label>
            <Select value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)} required>
              <option value="">Select…</option>
              {workTypes.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Per</Label>
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>₹ / unit</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Effective from</Label>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />
          </div>
          <div className="col-span-2 sm:col-span-5">
            {error ? (
              <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <Button type="submit" disabled={busy || !workTypeId}>
              {busy ? "Saving…" : "Set benchmark (history is kept)"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
