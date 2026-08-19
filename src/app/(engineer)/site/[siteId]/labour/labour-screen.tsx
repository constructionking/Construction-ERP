"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
} from "@/components/ui";
import { AmendButton } from "@/components/AmendButton";
import { cn } from "@/lib/cn";

interface WorkTypeOpt {
  id: string;
  name: string;
  defaultUnit: string;
}

interface LabourRow {
  entityId: string;
  entryType: "day_rate" | "period";
  source: "morning_market" | "contractor";
  contractorName: string | null;
  workTypeId: string;
  workersCount: number;
  rate: string;
  rateBasis: "per_day" | "per_unit";
  outputQty: string | null;
  outputUnit: string | null;
  entryDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  version: number;
  createdToday: boolean;
  closed: boolean;
}

export function LabourScreen({
  siteId,
  today,
  workTypes,
  entries,
}: {
  siteId: string;
  today: string;
  workTypes: WorkTypeOpt[];
  entries: LabourRow[];
}) {
  const workTypeById = new Map(workTypes.map((w) => [w.id, w]));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Departmental labour
      </h2>
      <LabourForm siteId={siteId} today={today} workTypes={workTypes} />

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <EmptyState title="No labour entries yet" />
          ) : (
            entries.map((entry) => (
              <LabourEntryCard
                key={entry.entityId}
                entry={entry}
                today={today}
                workType={workTypeById.get(entry.workTypeId)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabourForm({
  siteId,
  today,
  workTypes,
}: {
  siteId: string;
  today: string;
  workTypes: WorkTypeOpt[];
}) {
  const router = useRouter();
  // THE first choice, as designed: single day vs period, before anything else.
  const [entryType, setEntryType] = useState<"day_rate" | "period" | null>(null);
  const [source, setSource] = useState<"morning_market" | "contractor">("morning_market");
  const [contractorName, setContractorName] = useState("");
  const [workTypeId, setWorkTypeId] = useState("");
  const [workersCount, setWorkersCount] = useState("");
  const [rate, setRate] = useState("");
  const [rateBasis, setRateBasis] = useState<"per_day" | "per_unit">("per_day");
  const [outputQty, setOutputQty] = useState("");
  const [periodStart, setPeriodStart] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const workType = workTypes.find((w) => w.id === workTypeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entryType) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/labour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          entryType,
          source,
          contractorName: source === "contractor" ? contractorName : undefined,
          workTypeId,
          workersCount: Number(workersCount),
          rate: Number(rate),
          rateBasis,
          outputQty: outputQty ? Number(outputQty) : undefined,
          outputUnit: outputQty && workType ? workType.defaultUnit : undefined,
          entryDate: entryType === "day_rate" ? today : undefined,
          periodStart: entryType === "period" ? periodStart : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Could not submit" });
        return;
      }
      setMsg({
        ok: true,
        text: data.flag
          ? "Recorded — cost is above the owner's benchmark and has been flagged."
          : entryType === "period"
            ? "Period opened. Close it with the final output when the gang finishes."
            : "Recorded.",
      });
      setWorkersCount("");
      setRate("");
      setOutputQty("");
      setEntryType(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (entryType === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New labour entry — first, what kind?</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => {
              setEntryType("day_rate");
              setSource("morning_market");
            }}
            className="rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400"
          >
            <p className="text-2xl">🌅</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">For the day</p>
            <p className="text-xs text-slate-500">
              Morning labour market — gang works today only, settled at day rate
            </p>
          </button>
          <button
            onClick={() => {
              setEntryType("period");
              setSource("contractor");
            }}
            className="rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400"
          >
            <p className="text-2xl">📅</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">For a period</p>
            <p className="text-xs text-slate-500">
              From a contractor — start date now, close with final output when finished
            </p>
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-brand-200">
      <CardHeader>
        <CardTitle>
          {entryType === "day_rate" ? "🌅 Day labour — " + today : "📅 Period labour"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Source</Label>
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="morning_market">Morning labour market</option>
              <option value="contractor">Contractor&apos;s labour</option>
            </Select>
          </div>
          {source === "contractor" ? (
            <div>
              <Label>Contractor name</Label>
              <Input
                value={contractorName}
                onChange={(e) => setContractorName(e.target.value)}
                required
              />
            </div>
          ) : null}
          <div>
            <Label>Work type</Label>
            <Select value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)} required>
              <option value="">Select work…</option>
              {workTypes.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.defaultUnit})
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Workers</Label>
              <Input
                type="number"
                inputMode="numeric"
                min="1"
                value={workersCount}
                onChange={(e) => setWorkersCount(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Rate basis</Label>
              <Select
                value={rateBasis}
                onChange={(e) => setRateBasis(e.target.value as typeof rateBasis)}
              >
                <option value="per_day">₹ per worker per day</option>
                <option value="per_unit">₹ per unit of output</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rate (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            </div>
            {entryType === "period" ? (
              <div>
                <Label>Period start</Label>
                <Input
                  type="date"
                  value={periodStart}
                  max={today}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  required
                />
              </div>
            ) : (
              <div>
                <Label>Output today {workType ? `(${workType.defaultUnit})` : ""}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={outputQty}
                  onChange={(e) => setOutputQty(e.target.value)}
                />
              </div>
            )}
          </div>
          {msg ? (
            <p
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              )}
            >
              {msg.text}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setEntryType(null)}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || !workTypeId}>
              {busy ? "Working…" : entryType === "period" ? "Open period" : "Submit"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LabourEntryCard({
  entry,
  today,
  workType,
}: {
  entry: LabourRow;
  today: string;
  workType?: WorkTypeOpt;
}) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [closeQty, setCloseQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function closePeriod(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/labour/${entry.entityId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedOn: today, finalOutputQty: Number(closeQty) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not close");
        return;
      }
      setClosing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const isOpenPeriod = entry.entryType === "period" && !entry.closed;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">
            {workType?.name ?? "Work"} · {entry.workersCount} workers · ₹
            {Number(entry.rate).toLocaleString("en-IN")}
            {entry.rateBasis === "per_day" ? "/day" : `/${entry.outputUnit ?? "unit"}`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {entry.entryType === "day_rate"
              ? `${entry.entryDate} · morning market`
              : `from ${entry.periodStart} · ${entry.contractorName ?? "contractor"}`}
            {entry.outputQty ? ` · output ${entry.outputQty} ${entry.outputUnit ?? ""}` : ""}
          </p>
          <div className="mt-1 flex gap-1.5">
            <Badge tone={entry.entryType === "day_rate" ? "blue" : "neutral"}>
              {entry.entryType === "day_rate" ? "Day" : "Period"}
            </Badge>
            {isOpenPeriod ? <Badge tone="amber">Open</Badge> : null}
            {entry.closed ? <Badge tone="green">Closed</Badge> : null}
            {entry.version > 1 ? <Badge tone="amber">v{entry.version}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {isOpenPeriod ? (
            <button
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => setClosing(true)}
            >
              Close period
            </button>
          ) : null}
          {entry.createdToday && !entry.closed ? (
            <AmendButton
              recordType="labour_entry"
              entityId={entry.entityId}
              fields={[
                { name: "workersCount", label: "Workers", type: "number", value: String(entry.workersCount) },
                { name: "rate", label: "Rate (₹)", type: "number", value: entry.rate },
              ]}
              carry={{
                source: entry.source,
                contractorName: entry.contractorName ?? undefined,
                workTypeId: entry.workTypeId,
                rateBasis: entry.rateBasis,
                outputQty: entry.outputQty ? Number(entry.outputQty) : undefined,
                outputUnit: entry.outputUnit ?? undefined,
                entryDate: entry.entryDate ?? undefined,
                periodStart: entry.periodStart ?? undefined,
                periodEnd: entry.periodEnd ?? undefined,
              }}
            />
          ) : null}
        </div>
      </div>

      {closing ? (
        <form onSubmit={closePeriod} className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <Label>Final output ({workType?.defaultUnit ?? "unit"}) — closes on {today}</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0.001"
              step="0.001"
              required
              value={closeQty}
              onChange={(e) => setCloseQty(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !closeQty} className="flex-1">
              {busy ? "Closing…" : "Close & record output"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
