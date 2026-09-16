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
  Textarea,
} from "@/components/ui";
import { formatINR } from "@/lib/format/inr";
import { cn } from "@/lib/cn";

interface MaterialOpt {
  id: string;
  name: string;
  unit: string;
}

// One item per line, typed by the engineer (needs differ site to site).
type MaterialLine = {
  item: string;
  type: "material" | "tool" | "other";
  qty: number;
  unit: string;
  materialId?: string; // older records linked to the material master
};
type FundLine = { head: string; amount: number };

const LINE_TYPES: Array<{ key: MaterialLine["type"]; label: string; hint: string }> = [
  { key: "material", label: "Material", hint: "e.g. Cement OPC 43, Coarse sand, 20 mm aggregate, TMT 12 mm" },
  { key: "tool", label: "Tool / equipment", hint: "e.g. Concrete mixer (hire), Vibrator needle, Shovels, Wheelbarrow" },
  { key: "other", label: "Other", hint: "e.g. Diesel, Curing compound, Binding wire, Safety helmets" },
];
const UNIT_SUGGESTIONS = ["bags", "cft", "cum", "kg", "ton", "nos", "litre", "mtr", "sqft", "sqm", "set", "days (hire)"];

const emptyLine = (): MaterialLine => ({ item: "", type: "material", qty: 0, unit: "" });

interface ReqItem {
  entityId: string;
  kind: "material" | "fund";
  lines: MaterialLine[] | FundLine[];
  amountTotal: number | null;
  justification: string;
  neededBy: string | null;
  createdAt: string;
  version: number;
  state: string;
  editable: boolean;
  latestReason: string | null;
}

const STATE_TONES: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  pending: "blue",
  resubmitted: "blue",
  approved: "green",
  partially_approved: "green",
  awaiting_owner: "blue",
  awaiting_release: "amber",
  released: "green",
  owner_rejected: "red",
  changes_requested: "amber",
  rejected: "red",
  queried: "amber",
  queued: "neutral",
};

const STATE_LABELS: Record<string, string> = {
  awaiting_owner: "with owner",
  awaiting_release: "release pending",
  owner_rejected: "owner rejected",
  released: "funds released",
  changes_requested: "change requested",
};

export function RequisitionsScreen({
  siteId,
  materials,
  items,
}: {
  siteId: string;
  materials: MaterialOpt[];
  items: ReqItem[];
}) {
  const [editing, setEditing] = useState<ReqItem | null>(null);
  const [creating, setCreating] = useState(false);
  const materialById = new Map(materials.map((m) => [m.id, m]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          My requests
        </h2>
        <Button onClick={() => setCreating(true)}>+ New request</Button>
      </div>

      {creating || editing ? (
        <RequisitionForm
          siteId={siteId}
          materials={materials}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No requests yet"
          hint="Raise material demands or fund allocation requests here"
        />
      ) : (
        items.map((item) => (
          <Card key={item.entityId}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {item.kind === "fund"
                      ? `Fund · ${formatINR(item.amountTotal ?? 0)}`
                      : "Material request"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(item.createdAt).toLocaleDateString("en-IN")}
                    {item.neededBy ? ` · needed by ${item.neededBy}` : ""}
                  </p>
                </div>
                <Badge tone={STATE_TONES[item.state] ?? "neutral"}>
                  {STATE_LABELS[item.state] ?? item.state.replace(/_/g, " ")}
                  {item.version > 1 ? ` · v${item.version}` : ""}
                </Badge>
              </div>
              <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2.5">
                {item.kind === "fund"
                  ? (item.lines as FundLine[]).map((line, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-600">{line.head}</span>
                        <span className="font-medium">{formatINR(line.amount)}</span>
                      </div>
                    ))
                  : (item.lines as MaterialLine[]).map((line, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-600">
                          {line.item ??
                            (line.materialId ? materialById.get(line.materialId)?.name : undefined) ??
                            "Item"}
                          {line.type && line.type !== "material" ? (
                            <span className="ml-1 text-xs text-slate-400">({line.type})</span>
                          ) : null}
                        </span>
                        <span className="font-medium">
                          {line.qty.toLocaleString("en-IN")} {line.unit}
                        </span>
                      </div>
                    ))}
              </div>
              {item.latestReason ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Approver: {item.latestReason}
                </p>
              ) : null}
              {item.editable || item.state === "queried" || item.state === "changes_requested" ? (
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => setEditing(item)}>
                    {item.editable
                      ? "Edit (before pickup)"
                      : item.state === "changes_requested"
                        ? "Revise & resubmit"
                        : "Answer query & resubmit"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function RequisitionForm({
  siteId,
  materials,
  existing,
  onClose,
}: {
  siteId: string;
  materials: MaterialOpt[];
  existing: ReqItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"material" | "fund">(existing?.kind ?? "fund");
  const [fundLines, setFundLines] = useState<FundLine[]>(
    existing?.kind === "fund" ? (existing.lines as FundLine[]) : [{ head: "", amount: 0 }]
  );
  const [materialLines, setMaterialLines] = useState<MaterialLine[]>(
    existing?.kind === "material"
      ? (existing.lines as MaterialLine[]).map((l) => ({
          ...l,
          // Older records carried only a materialId — show its name as the item.
          item: l.item ?? (l.materialId ? materials.find((m) => m.id === l.materialId)?.name ?? "" : ""),
          type: l.type ?? "material",
        }))
      : [emptyLine()]
  );
  const [justification, setJustification] = useState(existing?.justification ?? "");
  const [neededBy, setNeededBy] = useState(existing?.neededBy ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAmend = existing !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines =
        kind === "fund"
          ? fundLines.filter((l) => l.head.trim() && l.amount > 0)
          : materialLines
              .filter((l) => l.item.trim() && l.qty > 0 && l.unit.trim())
              .map((l) => ({ ...l, item: l.item.trim(), unit: l.unit.trim() }));
      const payload = {
        kind,
        lines,
        justification,
        neededBy: neededBy || undefined,
      };
      let res: Response;
      if (isAmend) {
        res = await fetch("/api/amendments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordType: "requisition",
            entityId: existing!.entityId,
            reason,
            data: payload,
          }),
        });
      } else {
        res = await fetch("/api/requisitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, siteId }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not submit");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-brand-200">
      <CardHeader>
        <CardTitle>{isAmend ? "Edit request" : "New request"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          {!isAmend ? (
            <div className="flex rounded-lg bg-slate-200/70 p-1">
              {(["fund", "material"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-sm font-medium",
                    kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  )}
                >
                  {k === "fund" ? "💰 Fund allocation" : "🧱 Material demand"}
                </button>
              ))}
            </div>
          ) : null}

          {kind === "fund" ? (
            <div className="space-y-2">
              {fundLines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
                  <Input
                    placeholder="Expense head (e.g. diesel)"
                    value={line.head}
                    onChange={(e) =>
                      setFundLines((ls) =>
                        ls.map((l, j) => (j === i ? { ...l, head: e.target.value } : l))
                      )
                    }
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    placeholder="₹"
                    value={line.amount || ""}
                    onChange={(e) =>
                      setFundLines((ls) =>
                        ls.map((l, j) => (j === i ? { ...l, amount: Number(e.target.value) } : l))
                      )
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFundLines((ls) => [...ls, { head: "", amount: 0 }])}
              >
                + Add line
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Type each item yourself — one item per line. Needs differ from site to site, so
                there is no fixed list.
              </p>
              <datalist id="demand-units">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {materialLines.map((line, i) => {
                const meta = LINE_TYPES.find((t) => t.key === line.type) ?? LINE_TYPES[0];
                const update = (patch: Partial<MaterialLine>) =>
                  setMaterialLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
                return (
                  <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-center gap-1">
                      {LINE_TYPES.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => update({ type: t.key })}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium",
                            line.type === t.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                      {materialLines.length > 1 ? (
                        <button
                          type="button"
                          className="ml-auto text-xs text-red-600"
                          onClick={() => setMaterialLines((ls) => ls.filter((_, j) => j !== i))}
                        >
                          remove
                        </button>
                      ) : null}
                    </div>
                    <Input
                      placeholder={`${meta.label} name — ${meta.hint}`}
                      value={line.item}
                      onChange={(e) => update({ item: e.target.value })}
                      maxLength={160}
                    />
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0.001"
                        step="0.001"
                        placeholder="Qty"
                        value={line.qty || ""}
                        onChange={(e) => update({ qty: Number(e.target.value) })}
                      />
                      <Input
                        list="demand-units"
                        placeholder="Unit (bags, cft, nos…)"
                        value={line.unit}
                        onChange={(e) => update({ unit: e.target.value })}
                        maxLength={20}
                      />
                    </div>
                  </div>
                );
              })}
              <Button type="button" variant="ghost" onClick={() => setMaterialLines((ls) => [...ls, emptyLine()])}>
                + Add another item
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Needed by</Label>
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>
              Justification <span className="text-red-600">*</span>
            </Label>
            <Textarea
              rows={2}
              required
              minLength={5}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
          {isAmend ? (
            <div>
              <Label>
                Reason for this change <span className="text-red-600">*</span>
              </Label>
              <Textarea
                rows={2}
                required
                minLength={5}
                placeholder="Why are you changing the request?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={busy || (isAmend && reason.trim().length < 5)}
            >
              {busy ? "Submitting…" : isAmend ? "Resubmit" : "Submit request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
