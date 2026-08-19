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
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  Td,
  Th,
  Textarea,
} from "@/components/ui";
import { AmendButton } from "@/components/AmendButton";
import { cn } from "@/lib/cn";

interface MaterialOpt {
  id: string;
  name: string;
  unit: string;
}
interface ActivityOpt {
  id: string;
  code: string;
  name: string;
}
interface MixOpt {
  id: string;
  code: string;
  name: string;
}
interface StockLine {
  materialId: string;
  name: string;
  unit: string;
  received: number;
  consumed: number;
  balance: number;
  lastScanQty: number | null;
  scanVariancePct: number | null;
}
interface ReceiptRow {
  id: string;
  entityId: string;
  materialId: string;
  qty: string;
  unit: string;
  supplier: string;
  challanNo: string;
  qualityAdequate: boolean;
  qualityRemarks: string | null;
  receivedDate: string;
  version: number;
  createdToday: boolean;
  requisitionEntityId: string | null;
  photoIds: string[];
}
interface ConsumptionRow {
  id: string;
  entityId: string;
  materialId: string;
  activityId: string;
  mixDesignId: string | null;
  qty: string;
  entryDate: string;
  version: number;
  createdToday: boolean;
}

const TABS = ["Stock", "Receive", "Consume"] as const;

export function InventoryTabs(props: {
  siteId: string;
  today: string;
  stock: StockLine[];
  materials: MaterialOpt[];
  activities: ActivityOpt[];
  mixDesigns: MixOpt[];
  receipts: ReceiptRow[];
  consumption: ConsumptionRow[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Stock");
  const materialById = new Map(props.materials.map((m) => [m.id, m]));
  const activityById = new Map(props.activities.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg bg-slate-200/70 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Stock" ? (
        <Card>
          <CardHeader>
            <CardTitle>Running stock</CardTitle>
          </CardHeader>
          <CardContent>
            {props.stock.length === 0 ? (
              <EmptyState title="No stock movement yet" hint="Record a receipt to begin" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Material</Th>
                    <Th className="text-right">In</Th>
                    <Th className="text-right">Out</Th>
                    <Th className="text-right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {props.stock.map((line) => (
                    <tr key={line.materialId}>
                      <Td>
                        <span className="font-medium">{line.name}</span>
                        <span className="ml-1 text-xs text-slate-400">{line.unit}</span>
                        {line.lastScanQty !== null && line.scanVariancePct !== null ? (
                          <p className="text-xs text-slate-400">
                            scan: {line.lastScanQty.toLocaleString("en-IN")} (
                            {line.scanVariancePct > 0 ? "+" : ""}
                            {line.scanVariancePct}%)
                          </p>
                        ) : null}
                      </Td>
                      <Td className="text-right">{line.received.toLocaleString("en-IN")}</Td>
                      <Td className="text-right">{line.consumed.toLocaleString("en-IN")}</Td>
                      <Td className="text-right font-semibold">
                        {line.balance.toLocaleString("en-IN")}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "Receive" ? (
        <ReceiveTab {...props} materialById={materialById} />
      ) : null}

      {tab === "Consume" ? (
        <ConsumeTab {...props} materialById={materialById} activityById={activityById} />
      ) : null}
    </div>
  );
}

function ReceiveTab(
  props: Parameters<typeof InventoryTabs>[0] & { materialById: Map<string, MaterialOpt> }
) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [qualityAdequate, setQualityAdequate] = useState(true);
  const [qualityRemarks, setQualityRemarks] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const material = props.materialById.get(materialId);

  async function addPhoto(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        form.set("siteId", props.siteId);
        form.set("kind", "receipt");
        form.set("takenAt", new Date().toISOString());
        const res = await fetch("/api/photos", { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          setPhotoIds((ids) => [...ids, data.photo.id]);
        }
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!material) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: props.siteId,
          materialId,
          qty: Number(qty),
          unit: material.unit,
          supplier,
          challanNo,
          qualityAdequate,
          qualityRemarks: qualityRemarks || undefined,
          photoIds,
          receivedDate: props.today,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Could not submit" });
        return;
      }
      setMsg({
        ok: true,
        text: qualityAdequate
          ? "Receipt recorded."
          : "Receipt recorded — quality issue flagged to the owner.",
      });
      setQty("");
      setSupplier("");
      setChallanNo("");
      setQualityRemarks("");
      setPhotoIds([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Material received — {props.today}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Material</Label>
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
                <option value="">Select material…</option>
                {props.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Qty {material ? `(${material.unit})` : ""}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Challan no.</Label>
                <Input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label>Supplier</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} required />
            </div>
            <div>
              <Label>Quality check</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQualityAdequate(true)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium",
                    qualityAdequate
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-300 text-slate-500"
                  )}
                >
                  ✓ Adequate
                </button>
                <button
                  type="button"
                  onClick={() => setQualityAdequate(false)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium",
                    !qualityAdequate
                      ? "border-red-500 bg-red-50 text-red-700"
                      : "border-slate-300 text-slate-500"
                  )}
                >
                  ✗ Not adequate
                </button>
              </div>
            </div>
            {!qualityAdequate ? (
              <div>
                <Label>
                  Quality remarks <span className="text-red-600">*</span>
                </Label>
                <Textarea
                  rows={2}
                  required
                  value={qualityRemarks}
                  placeholder="What is wrong with the material?"
                  onChange={(e) => setQualityRemarks(e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => addPhoto(e.target.files)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                📷 {photoIds.length ? `Photos (${photoIds.length})` : "Add photo"}
              </Button>
              <Button type="submit" disabled={busy || !materialId} className="flex-1">
                {busy ? "Working…" : "Submit receipt"}
              </Button>
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
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent receipts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.receipts.length === 0 ? (
            <EmptyState title="No receipts yet" />
          ) : (
            props.receipts.map((receipt) => {
              const material = props.materialById.get(receipt.materialId);
              return (
                <div
                  key={receipt.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {material?.name ?? "Material"} · {Number(receipt.qty).toLocaleString("en-IN")}{" "}
                      {receipt.unit}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {receipt.receivedDate} · {receipt.supplier} · Ch. {receipt.challanNo}
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      {!receipt.qualityAdequate ? <Badge tone="red">Quality issue</Badge> : null}
                      {receipt.version > 1 ? <Badge tone="amber">v{receipt.version}</Badge> : null}
                    </div>
                  </div>
                  {receipt.createdToday ? (
                    <AmendButton
                      recordType="material_receipt"
                      entityId={receipt.entityId}
                      fields={[
                        { name: "qty", label: `Qty (${receipt.unit})`, type: "number", value: receipt.qty },
                        { name: "challanNo", label: "Challan no.", type: "text", value: receipt.challanNo },
                        { name: "supplier", label: "Supplier", type: "text", value: receipt.supplier },
                      ]}
                      carry={{
                        materialId: receipt.materialId,
                        unit: receipt.unit,
                        qualityAdequate: receipt.qualityAdequate,
                        qualityRemarks: receipt.qualityRemarks ?? undefined,
                        photoIds: receipt.photoIds,
                        requisitionEntityId: receipt.requisitionEntityId ?? undefined,
                        receivedDate: receipt.receivedDate,
                      }}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ConsumeTab(
  props: Parameters<typeof InventoryTabs>[0] & {
    materialById: Map<string, MaterialOpt>;
    activityById: Map<string, ActivityOpt>;
  }
) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [mixDesignId, setMixDesignId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const material = props.materialById.get(materialId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/consumption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: props.siteId,
          materialId,
          activityId,
          mixDesignId: mixDesignId || undefined,
          qty: Number(qty),
          entryDate: props.today,
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
          ? "Recorded — consumption is above the mix-design norm and has been flagged."
          : "Consumption recorded.",
      });
      setQty("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Material consumed — {props.today}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Material</Label>
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
                <option value="">Select material…</option>
                {props.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Used on activity</Label>
              <Select value={activityId} onChange={(e) => setActivityId(e.target.value)} required>
                <option value="">Select activity…</option>
                {props.activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mix (for concrete)</Label>
                <Select value={mixDesignId} onChange={(e) => setMixDesignId(e.target.value)}>
                  <option value="">None / N.A.</option>
                  {props.mixDesigns.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Qty {material ? `(${material.unit})` : ""}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={busy || !materialId || !activityId} className="w-full">
              {busy ? "Working…" : "Submit consumption"}
            </Button>
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
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent consumption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.consumption.length === 0 ? (
            <EmptyState title="No consumption recorded yet" />
          ) : (
            props.consumption.map((entry) => {
              const material = props.materialById.get(entry.materialId);
              const activity = props.activityById.get(entry.activityId);
              return (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {material?.name ?? "Material"} ·{" "}
                      {Number(entry.qty).toLocaleString("en-IN")} {material?.unit ?? ""}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.entryDate} · {activity ? `${activity.code}` : ""}
                    </p>
                    {entry.version > 1 ? (
                      <Badge tone="amber" className="mt-1">
                        v{entry.version}
                      </Badge>
                    ) : null}
                  </div>
                  {entry.createdToday ? (
                    <AmendButton
                      recordType="consumption_entry"
                      entityId={entry.entityId}
                      fields={[
                        {
                          name: "qty",
                          label: `Qty (${material?.unit ?? ""})`,
                          type: "number",
                          value: entry.qty,
                        },
                      ]}
                      carry={{
                        materialId: entry.materialId,
                        activityId: entry.activityId,
                        mixDesignId: entry.mixDesignId ?? undefined,
                        entryDate: entry.entryDate,
                      }}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </>
  );
}
