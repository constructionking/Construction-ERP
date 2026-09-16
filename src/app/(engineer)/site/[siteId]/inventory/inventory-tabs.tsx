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
import { ActivityPicker } from "@/components/ActivityPicker";
import { GuidedCapture } from "@/components/GuidedCapture";
import { STEEL_DIAMETERS_MM, STANDARD_BAR_LENGTH_M, steelWeightKg } from "@/lib/telemetry/steel";
import { cn } from "@/lib/cn";

interface MaterialOpt {
  id: string;
  name: string;
  unit: string;
  category?: string;
}
interface ActivityOpt {
  id: string;
  code: string;
  name: string;
  defaultMixId?: string | null; // owner-set mix for this item (pre-selected)
  parent?: { id: string; name: string } | null;
}
interface MixOpt {
  id: string;
  code: string;
  name: string;
  outputUnit: string;
  status: string; // locked | provisional | tbd
  coefficients: { materialId: string; qtyPerUnit: number }[];
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
interface RecentScan {
  id: string;
  materialId: string;
  method: string;
  volumeCum: number;
  volumeCft: number;
  qty: number;
  unit: string;
  when: string;
}
// What the camera/AI estimated for the delivery being received.
interface DeliveryEstimateUse {
  id: string;
  qty: number;
  summary: string;
}
interface ApprovedDemand {
  entityId: string;
  createdAt: string;
  lines: { index: number; item: string; type: string; qty: number; unit: string }[];
}

const TABS = ["Stock", "Receive", "Consume"] as const;

export function InventoryTabs(props: {
  siteId: string;
  today: string;
  stock: StockLine[];
  materials: MaterialOpt[];
  activities: ActivityOpt[];
  mixDesigns: MixOpt[];
  progressToday: Record<string, number>; // activityId → qty recorded today
  aiAvailable: boolean;
  recentScans: RecentScan[];
  approvedDemands: ApprovedDemand[];
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
  const [estimate, setEstimate] = useState<DeliveryEstimateUse | null>(null);
  // Receiving against an owner-approved demand line.
  const [demandKey, setDemandKey] = useState("");
  const [demandInfo, setDemandInfo] = useState<{ item: string; remaining: number; unit: string; created: boolean } | null>(null);
  const [demandNeedsUnit, setDemandNeedsUnit] = useState<{ item: string; typedUnit: string } | null>(null);
  const [demandUnit, setDemandUnit] = useState("");
  // Master rows created on the fly from a demand line (not yet in props.materials).
  const [extraMaterials, setExtraMaterials] = useState<MaterialOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const allMaterials = [...props.materials, ...extraMaterials.filter((e) => !props.materialById.has(e.id))];
  const material = props.materialById.get(materialId) ?? extraMaterials.find((m) => m.id === materialId);
  const demandEntityId = demandKey ? demandKey.split(":")[0] : undefined;

  async function resolveDemand(key: string, unitOverride?: string) {
    setDemandKey(key);
    setDemandInfo(null);
    setDemandNeedsUnit(null);
    setEstimate(null);
    if (!key) return;
    const [entityId, idx] = key.split(":");
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/receipts/from-demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: props.siteId,
          requisitionEntityId: entityId,
          lineIndex: Number(idx),
          ...(unitOverride ? { unit: unitOverride } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Could not load the request line" });
        return;
      }
      if (data.needsUnit) {
        setDemandNeedsUnit({ item: data.item, typedUnit: data.typedUnit });
        return;
      }
      const m: MaterialOpt = data.material;
      setExtraMaterials((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
      setMaterialId(m.id);
      setQty(data.remaining > 0 ? String(data.remaining) : "");
      setDemandInfo({ item: data.line.item, remaining: data.remaining, unit: m.unit, created: data.created });
    } finally {
      setBusy(false);
    }
  }

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
          estimateId: estimate?.id,
          requisitionEntityId: demandEntityId,
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
      setEstimate(null);
      setDemandKey("");
      setDemandInfo(null);
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
            {props.approvedDemands.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <Label>Receiving against an approved request?</Label>
                <Select value={demandKey} onChange={(e) => void resolveDemand(e.target.value)} disabled={busy}>
                  <option value="">No — a fresh receipt</option>
                  {props.approvedDemands.map((d) => (
                    <optgroup key={d.entityId} label={`Approved request · ${d.createdAt}`}>
                      {d.lines.map((l) => (
                        <option key={`${d.entityId}:${l.index}`} value={`${d.entityId}:${l.index}`}>
                          {l.item} — {l.qty.toLocaleString("en-IN")} {l.unit}
                          {l.type !== "material" ? ` (${l.type})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                {demandNeedsUnit ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div>
                      <Label>
                        Unit for “{demandNeedsUnit.item}” — the request said “{demandNeedsUnit.typedUnit}”
                      </Label>
                      <Select value={demandUnit} onChange={(e) => setDemandUnit(e.target.value)} className="w-40 py-1.5">
                        <option value="">Pick a unit…</option>
                        {["BAG", "CFT", "CUM", "KG", "TON", "NOS", "LTR", "MTR", "SQM", "SET", "DAY"].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!demandUnit || busy} onClick={() => resolveDemand(demandKey, demandUnit)}>
                      Continue
                    </Button>
                  </div>
                ) : null}
                {demandInfo ? (
                  <p className="mt-2 text-xs text-emerald-800">
                    {demandInfo.created ? `“${demandInfo.item}” added to the stock register. ` : ""}
                    Still due on this line: {demandInfo.remaining.toLocaleString("en-IN")} {demandInfo.unit}. What you
                    receive here goes straight to the owner&apos;s inventory.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div>
              <Label>Material</Label>
              <Select
                value={materialId}
                onChange={(e) => {
                  setMaterialId(e.target.value);
                  setEstimate(null);
                }}
                required
                disabled={!!demandInfo}
              >
                <option value="">Select material…</option>
                {allMaterials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </div>
            {material ? (
              <DeliveryAssist
                siteId={props.siteId}
                material={material}
                aiAvailable={props.aiAvailable}
                recentScans={props.recentScans.filter((s) => s.materialId === material.id)}
                onPhoto={(id) => setPhotoIds((ids) => [...ids, id])}
                onUse={(e) => {
                  setEstimate(e);
                  setQty(String(e.qty));
                }}
              />
            ) : null}
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
                {estimate ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Checked against: {estimate.summary}. Enter the challan qty — a big gap is flagged to the owner.
                  </p>
                ) : null}
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

// Camera help for a delivery: steel → count bar ends (AI or by hand) → kg;
// sand/aggregate → pull a measured heap scan → CUM / cft. Whatever it says is
// an ESTIMATE the engineer checks the challan against; the human qty stands.
function DeliveryAssist({
  siteId,
  material,
  aiAvailable,
  recentScans,
  onPhoto,
  onUse,
}: {
  siteId: string;
  material: MaterialOpt;
  aiAvailable: boolean;
  recentScans: RecentScan[];
  onPhoto: (photoId: string) => void;
  onUse: (estimate: DeliveryEstimateUse) => void;
}) {
  const isSteel = material.category === "steel" || material.name.toLowerCase().includes("tmt");
  const isHeap = ["sand", "aggregate"].includes(material.category ?? "") || material.unit === "CUM";
  const [capturing, setCapturing] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [dia, setDia] = useState("12");
  const [lengthM, setLengthM] = useState(String(STANDARD_BAR_LENGTH_M));
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ai, setAi] = useState<{
    count: number;
    diameterMm: number | null;
    kg: number;
    confidence: number | null;
    rationale: string;
    countable: boolean;
    id: string;
  } | null>(null);

  if (!isSteel && !isHeap) return null;

  async function uploadCaptured(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("siteId", siteId);
    form.set("kind", "receipt");
    form.set("takenAt", new Date().toISOString());
    const res = await fetch("/api/photos", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    setPhotoIds((ids) => [...ids, data.photo.id]);
    onPhoto(data.photo.id);
    return data.photo.id as string;
  }

  async function countWithAi(photoId: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/receipts/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "steel_count",
          siteId,
          materialId: material.id,
          photoIds: [photoId],
          nominalDiaMm: Number(dia) || null,
          lengthM: Number(lengthM) || STANDARD_BAR_LENGTH_M,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "Could not estimate");
        return;
      }
      if (!data.available) {
        setNote(data.reason ?? "AI counting unavailable — use the calculator.");
        return;
      }
      const e = data.estimate;
      setAi({
        id: e.id,
        count: e.count ?? 0,
        diameterMm: e.diameterMm ? Number(e.diameterMm) : null,
        kg: Number(e.estimatedQty),
        confidence: e.confidence ? Number(e.confidence) : null,
        rationale: e.rationale ?? "",
        countable: data.ai?.countable ?? true,
      });
      if (data.ai?.diameterMismatch) {
        setNote(`The photo suggests Ø${data.ai.aiDiameterMm} mm, not Ø${dia} mm as on the challan — check the bar marking.`);
      }
      if (e.count) setCount(String(e.count));
    } finally {
      setBusy(false);
    }
  }

  async function useManual() {
    const c = Number(count);
    if (!(c > 0)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/receipts/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "manual_steel",
          siteId,
          materialId: material.id,
          photoIds,
          count: c,
          diameterMm: Number(dia),
          lengthM: Number(lengthM) || STANDARD_BAR_LENGTH_M,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "Could not save the count");
        return;
      }
      onUse({
        id: data.estimate.id,
        qty: Number(data.estimate.estimatedQty),
        summary: `${c} bars × Ø${dia} mm × ${lengthM} m = ${Number(data.estimate.estimatedQty).toLocaleString("en-IN")} ${material.unit}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function useScan(scan: RecentScan) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/receipts/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "scan_volume", siteId, materialId: material.id, scanId: scan.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "Could not use the scan");
        return;
      }
      onUse({
        id: data.estimate.id,
        qty: Number(data.estimate.estimatedQty),
        summary: `heap scan ${scan.volumeCum.toFixed(2)} m³ (${scan.volumeCft} cft)`,
      });
    } finally {
      setBusy(false);
    }
  }

  const manualKg = steelWeightKg({ count: Number(count) || 0, diameterMm: Number(dia) || 0, lengthM: Number(lengthM) || 0 });

  return (
    <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      {isSteel ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Count the bars from a photo
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Dia on challan (mm)</Label>
              <Select value={dia} onChange={(e) => setDia(e.target.value)} className="py-1.5">
                {STEEL_DIAMETERS_MM.map((d) => (
                  <option key={d} value={d}>
                    Ø{d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Bar length (m)</Label>
              <Input type="number" inputMode="decimal" step="0.1" min="1" value={lengthM} onChange={(e) => setLengthM(e.target.value)} className="py-1.5" />
            </div>
          </div>
          {capturing ? (
            <GuidedCapture
              mode="steel"
              captureLabel={aiAvailable ? "📸 Capture & count" : "📸 Capture"}
              onClose={() => setCapturing(false)}
              onCapture={async (file) => {
                setBusy(true);
                try {
                  const id = await uploadCaptured(file);
                  setCapturing(false);
                  if (aiAvailable) await countWithAi(id);
                  else setNote("Photo attached. Count the bar ends and enter the number below.");
                } catch (e) {
                  setNote(e instanceof Error ? e.message : "Upload failed");
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => setCapturing(true)}>
              {busy ? "Working…" : aiAvailable ? "📷 Photograph bundle end — AI counts the bars" : "📷 Photograph bundle end (guided)"}
            </Button>
          )}
          {ai ? (
            <div className="rounded-lg bg-white px-3 py-2 text-sm">
              {ai.countable ? (
                <>
                  <p className="font-medium text-slate-800">
                    AI counted {ai.count} bars{ai.diameterMm ? ` · Ø${ai.diameterMm} mm` : ""} → {ai.kg.toLocaleString("en-IN")} {material.unit}
                    {ai.confidence !== null ? <span className="ml-1 text-xs text-slate-400">(confidence {Math.round(ai.confidence * 100)}%)</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{ai.rationale}</p>
                  <Button
                    type="button"
                    className="mt-2 px-3 py-1.5 text-xs"
                    onClick={() =>
                      onUse({ id: ai.id, qty: ai.kg, summary: `AI count ${ai.count} bars × Ø${ai.diameterMm ?? dia} mm × ${lengthM} m` })
                    }
                  >
                    Use {ai.kg.toLocaleString("en-IN")} {material.unit}
                  </Button>
                </>
              ) : (
                <p className="text-amber-700">Could not count from this shot: {ai.rationale}</p>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2 border-t border-brand-100 pt-2">
            <div>
              <Label>Bars counted by you</Label>
              <Input type="number" inputMode="numeric" min="1" value={count} onChange={(e) => setCount(e.target.value)} className="w-28 py-1.5" placeholder="e.g. 84" />
            </div>
            <span className="pb-2 text-xs text-slate-500">
              = {manualKg > 0 ? `${(material.unit === "TON" ? manualKg / 1000 : manualKg).toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${material.unit}` : "—"} (d²/162 × length)
            </span>
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy || !(Number(count) > 0)} onClick={useManual}>
              Use my count
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Measure the delivered heap
          </p>
          {recentScans.length === 0 ? (
            <p className="text-xs text-slate-600">
              No heap scan of {material.name} in the last 3 days. Scan the delivered heap from the{" "}
              <a href={`/site/${siteId}/scan`} className="font-medium text-brand-700 underline">
                Scan tab
              </a>{" "}
              (guided capture) and it will appear here to fill the quantity.
            </p>
          ) : (
            recentScans.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {s.volumeCum.toFixed(2)} m³ · {s.volumeCft} cft
                </span>
                <span className="text-xs text-slate-500">
                  → {s.qty.toLocaleString("en-IN")} {s.unit} · {s.method} · {new Date(s.when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <Button type="button" variant="secondary" className="ml-auto px-3 py-1.5 text-xs" disabled={busy} onClick={() => useScan(s)}>
                  Use
                </Button>
              </div>
            ))
          )}
        </>
      )}
      {note ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p> : null}
    </div>
  );
}

function ConsumeTab(
  props: Parameters<typeof InventoryTabs>[0] & {
    materialById: Map<string, MaterialOpt>;
    activityById: Map<string, ActivityOpt>;
  }
) {
  const router = useRouter();
  const [activityId, setActivityId] = useState("");
  const [mixDesignId, setMixDesignId] = useState("");
  const [workQty, setWorkQty] = useState("");
  const [workQtyFromProgress, setWorkQtyFromProgress] = useState(false);
  // Actual used per material (keyed by materialId); mix materials + extras.
  const [actual, setActual] = useState<Record<string, string>>({});
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mix = props.mixDesigns.find((m) => m.id === mixDesignId);
  const mixMaterialIds = mix ? mix.coefficients.map((c) => c.materialId) : [];
  const work = Number(workQty) || 0;
  const rows = [
    ...mixMaterialIds.map((id) => ({
      materialId: id,
      theoretical: (mix!.coefficients.find((c) => c.materialId === id)?.qtyPerUnit ?? 0) * work,
      extra: false,
    })),
    ...extraIds.filter((id) => !mixMaterialIds.includes(id)).map((id) => ({ materialId: id, theoretical: null as number | null, extra: true })),
  ];
  const filledCount = rows.filter((r) => Number(actual[r.materialId]) > 0).length;

  function pickActivity(id: string) {
    setActivityId(id);
    setMsg(null);
    const chosen = props.activityById.get(id);
    // The mix the owner set for this item (overridable) …
    setMixDesignId(chosen?.defaultMixId ?? "");
    // … and today's recorded work on it, for the theoretical column.
    const todayQty = props.progressToday[id];
    setWorkQty(todayQty ? String(todayQty) : "");
    setWorkQtyFromProgress(!!todayQty);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = rows
      .map((r) => ({ materialId: r.materialId, qty: Number(actual[r.materialId]) }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) {
      setMsg({ ok: false, text: "Enter the quantity actually used for at least one material." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/consumption/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: props.siteId,
          activityId,
          mixDesignId: mixDesignId || undefined,
          entryDate: props.today,
          lines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Could not submit" });
        return;
      }
      const flagged: string[] = data.flagged ?? [];
      setMsg({
        ok: true,
        text:
          flagged.length > 0
            ? `Recorded ${lines.length} material${lines.length > 1 ? "s" : ""}. ${flagged
                .map((id) => props.materialById.get(id)?.name ?? "A material")
                .join(", ")} ${flagged.length > 1 ? "are" : "is"} above the mix norm and has been flagged to the owner.`
            : `Recorded ${lines.length} material${lines.length > 1 ? "s" : ""} for today.`,
      });
      setActual({});
      setExtraIds([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Daily consumption report — {props.today}</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Report the EXACT quantities used today — cement, coarse sand, steel… Actuals
            always differ from the mix norm; the owner sees theoretical vs actual side by side.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <ActivityPicker
              activities={props.activities}
              value={activityId}
              onChange={pickActivity}
              required
              idPrefix="consume"
            />
            {activityId ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Mix used</Label>
                    <Select
                      value={mixDesignId}
                      onChange={(e) => {
                        setMixDesignId(e.target.value);
                        setActual({});
                      }}
                    >
                      <option value="">None / N.A.</option>
                      {props.mixDesigns.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.status === "tbd" ? " (rate TBD)" : m.status === "provisional" ? " (prov.)" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>
                      Work done today{mix ? ` (${mix.outputUnit})` : ""}
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      value={workQty}
                      onChange={(e) => {
                        setWorkQty(e.target.value);
                        setWorkQtyFromProgress(false);
                      }}
                      placeholder="qty"
                    />
                    {workQtyFromProgress ? (
                      <p className="mt-1 text-[11px] text-slate-500">from today&apos;s progress entry</p>
                    ) : null}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    No mix on this item — add the materials you used below.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2.5 py-1.5 text-left">Material</th>
                          <th className="px-2.5 py-1.5 text-right">Norm</th>
                          <th className="px-2.5 py-1.5 text-right">Actually used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const m = props.materialById.get(r.materialId);
                          const used = Number(actual[r.materialId]) || 0;
                          const over =
                            r.theoretical !== null && r.theoretical > 0 && used > r.theoretical * 1.1;
                          return (
                            <tr key={r.materialId} className="border-t border-slate-100">
                              <td className="px-2.5 py-1.5">
                                <span className="font-medium text-slate-800">{m?.name ?? "?"}</span>
                                <span className="ml-1 text-xs text-slate-400">{m?.unit}</span>
                                {r.extra ? (
                                  <button
                                    type="button"
                                    className="ml-2 text-[11px] text-red-600"
                                    onClick={() => setExtraIds((ids) => ids.filter((x) => x !== r.materialId))}
                                  >
                                    remove
                                  </button>
                                ) : null}
                              </td>
                              <td className="px-2.5 py-1.5 text-right text-slate-500">
                                {r.theoretical === null ? "—" : work > 0 ? fmt(r.theoretical) : <span className="text-slate-300">enter work qty</span>}
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.001"
                                  min="0"
                                  value={actual[r.materialId] ?? ""}
                                  onChange={(e) =>
                                    setActual((a) => ({ ...a, [r.materialId]: e.target.value }))
                                  }
                                  className={cn("ml-auto w-28 py-1.5 text-right", over && "border-amber-400 bg-amber-50")}
                                  placeholder="0"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setExtraIds((ids) => [...new Set([...ids, e.target.value])]);
                      e.target.value = "";
                    }}
                    className="w-64 py-1.5 text-xs"
                  >
                    <option value="">+ add another material used…</option>
                    {props.materials
                      .filter((m) => !mixMaterialIds.includes(m.id) && !extraIds.includes(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.unit})
                        </option>
                      ))}
                  </Select>
                  <span className="text-xs text-slate-400">
                    {filledCount} of {rows.length} filled
                  </span>
                </div>
              </>
            ) : null}

            <Button type="submit" disabled={busy || !activityId || filledCount === 0} className="w-full">
              {busy ? "Working…" : `Submit report${filledCount > 0 ? ` (${filledCount})` : ""}`}
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
