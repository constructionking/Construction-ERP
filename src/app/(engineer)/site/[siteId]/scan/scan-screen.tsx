"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/cn";

interface MaterialOpt {
  id: string;
  name: string;
  unit: string;
}

interface ScanRow {
  id: string;
  materialId: string;
  method: string;
  status: string;
  createdAt: string;
  result: {
    computedQty: string | null;
    computedVolumeCum: string | null;
    qtyUnit: string;
    confidence: string | null;
  } | null;
  decision: { decision: string; engineerQty: string | null; variancePct: string | null } | null;
  job: { error: string | null } | null;
}

const TARGET_FRAMES = 20;
const MIN_FRAMES = 8;

export function ScanScreen({
  siteId,
  materials,
}: {
  siteId: string;
  materials: MaterialOpt[];
}) {
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [mode, setMode] = useState<"list" | "capture" | "template">("list");
  const materialById = new Map(materials.map((m) => [m.id, m]));

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/scans?siteId=${siteId}`);
    if (res.ok) setScans((await res.json()).scans);
  }, [siteId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 8000); // live status while jobs process
    return () => clearInterval(timer);
  }, [refresh]);

  if (mode === "capture") {
    return (
      <OrbitCapture
        siteId={siteId}
        materials={materials}
        onDone={() => {
          setMode("list");
          refresh();
        }}
      />
    );
  }
  if (mode === "template") {
    return (
      <TemplateEstimate
        siteId={siteId}
        materials={materials}
        onDone={() => {
          setMode("list");
          refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Stockpile measurement
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          onClick={() => setMode("capture")}
          className="rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-brand-400"
        >
          <p className="text-2xl">📷</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">Camera scan</p>
          <p className="text-xs text-slate-500">
            Walk a slow circle around the pile with the printed marker placed against it.
            Typical accuracy ±10–15% on a good capture.
          </p>
        </button>
        <button
          onClick={() => setMode("template")}
          className="rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-brand-400"
        >
          <p className="text-2xl">📐</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">Measure & estimate</p>
          <p className="text-xs text-slate-500">
            Tape-measure the pile and pick its shape — instant estimate (±25%). Use when a
            scan fails or conditions are bad.
          </p>
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {scans.length === 0 ? (
            <EmptyState title="No scans yet" hint="Every scan and its verdict is reported to the owner" />
          ) : (
            scans.map((scan) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                material={materialById.get(scan.materialId)}
                onDecided={refresh}
                onFallback={() => setMode("template")}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScanCard({
  scan,
  material,
  onDecided,
  onFallback,
}: {
  scan: ScanRow;
  material?: MaterialOpt;
  onDecided: () => void;
  onFallback: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [actualQty, setActualQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "accepted" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scan.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          engineerQty: decision === "rejected" ? Number(actualQty) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setRejecting(false);
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  const statusTone: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
    capturing: "neutral",
    queued: "blue",
    processing: "blue",
    computed: "amber",
    accepted: "green",
    rejected: "red",
    failed: "red",
  };

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {material?.name ?? "Material"} ·{" "}
            {scan.method === "photogrammetry" ? "camera scan" : scan.method}
          </p>
          <p className="text-xs text-slate-500">
            {new Date(scan.createdAt).toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {scan.result?.computedQty ? (
            <p className="mt-1 text-sm text-slate-700">
              Measured:{" "}
              <span className="font-semibold">
                {Number(scan.result.computedQty).toLocaleString("en-IN")} {scan.result.qtyUnit}
              </span>
              {scan.result.confidence ? (
                <span className="text-xs text-slate-400">
                  {" "}
                  · confidence {(Number(scan.result.confidence) * 100).toFixed(0)}%
                </span>
              ) : null}
            </p>
          ) : null}
          {scan.decision ? (
            <p className="mt-0.5 text-xs text-slate-500">
              {scan.decision.decision === "accepted"
                ? "Accepted by you"
                : `You entered ${Number(scan.decision.engineerQty).toLocaleString("en-IN")} (${scan.decision.variancePct}% variance) — reported to owner`}
            </p>
          ) : null}
          {scan.status === "failed" ? (
            <p className="mt-1 text-xs text-red-600">
              {scan.job?.error ?? "Scan failed"} —{" "}
              <button className="font-medium underline" onClick={onFallback}>
                use measure & estimate instead
              </button>
            </p>
          ) : null}
        </div>
        <Badge tone={statusTone[scan.status] ?? "neutral"}>{scan.status}</Badge>
      </div>

      {scan.status === "computed" && !scan.decision ? (
        <div className="mt-3 space-y-2">
          {!rejecting ? (
            <div className="flex gap-2">
              <Button variant="success" className="flex-1" disabled={busy} onClick={() => decide("accepted")}>
                ✓ Looks right
              </Button>
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>
                ✗ Wrong — enter actual
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <Label>
                Actual quantity ({scan.result?.qtyUnit}) — both figures go to the owner
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0.001"
                step="0.001"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={busy || !actualQty} onClick={() => decide("rejected")}>
                  Submit actual qty
                </Button>
              </div>
            </div>
          )}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function OrbitCapture({
  siteId,
  materials,
  onDone,
}: {
  siteId: string;
  materials: MaterialOpt[];
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [markerSizeMm, setMarkerSizeMm] = useState("400");
  const [scanId, setScanId] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]); // uploaded photo ids
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCapture() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "photogrammetry",
          siteId,
          materialId,
          markerSizeMm: Number(markerSizeMm),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start scan");
        return;
      }
      setScanId(data.scan.id);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function captureFrame() {
    if (!videoRef.current || !scanId) return;
    setBusy(true);
    setError(null);
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Frame capture failed");

      const form = new FormData();
      form.set("file", new File([blob], `frame-${frames.length + 1}.jpg`, { type: "image/jpeg" }));
      form.set("siteId", siteId);
      form.set("kind", "scan_frame");
      form.set("takenAt", new Date().toISOString());
      const res = await fetch("/api/photos", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setFrames((f) => [...f, data.photo.id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!scanId || frames.length < MIN_FRAMES) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: frames, finalize: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not queue the scan");
        return;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.min(100, (frames.length / TARGET_FRAMES) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Camera scan
        </h2>
        <button className="text-sm font-medium text-slate-500" onClick={onDone}>
          ← Back
        </button>
      </div>

      {!cameraOn ? (
        <Card>
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Place the printed marker board flat against the base of the pile.</li>
              <li>Walk a slow full circle 3–5 m from the pile.</li>
              <li>
                Capture a frame every couple of steps — aim for {TARGET_FRAMES} frames with the
                whole pile in view; the marker should be visible in several of them.
              </li>
            </ol>
            <div>
              <Label>Material</Label>
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
                <option value="">Select material…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Marker size (mm, printed edge length)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min="50"
                max="2000"
                value={markerSizeMm}
                onChange={(e) => setMarkerSizeMm(e.target.value)}
              />
            </div>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <Button className="w-full" disabled={busy || !materialId} onClick={startCapture}>
              {busy ? "Starting…" : "Open camera"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>
                  {frames.length}/{TARGET_FRAMES} frames
                </span>
                <span>{frames.length >= MIN_FRAMES ? "enough to process" : `need ${MIN_FRAMES - frames.length} more`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    frames.length >= MIN_FRAMES ? "bg-emerald-500" : "bg-brand-500"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={captureFrame}>
                {busy ? "…" : "📸 Capture frame"}
              </Button>
              <Button
                variant="success"
                disabled={busy || frames.length < MIN_FRAMES}
                onClick={finalize}
              >
                Done — process
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TemplateEstimate({
  siteId,
  materials,
  onDone,
}: {
  siteId: string;
  materials: MaterialOpt[];
  onDone: () => void;
}) {
  const [materialId, setMaterialId] = useState("");
  const [shape, setShape] = useState<"cone" | "rect_stack" | "windrow">("cone");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shapes = [
    { key: "cone" as const, label: "⛰ Cone / heap", dims: "base diameter + height" },
    { key: "rect_stack" as const, label: "🧱 Rectangular stack", dims: "length + width + height" },
    { key: "windrow" as const, label: "🏔 Long ridge pile", dims: "length + width + height" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "template",
          siteId,
          materialId,
          shape,
          dims: {
            length: Number(length),
            width: shape === "cone" ? undefined : Number(width),
            height: Number(height),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not compute");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Measure & estimate
        </h2>
        <button className="text-sm font-medium text-slate-500" onClick={onDone}>
          ← Back
        </button>
      </div>
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Material</Label>
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
                <option value="">Select material…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Pile shape</Label>
              <div className="space-y-2">
                {shapes.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setShape(s.key)}
                    className={cn(
                      "w-full rounded-lg border-2 px-3 py-2.5 text-left text-sm",
                      shape === s.key
                        ? "border-brand-500 bg-brand-50"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="ml-2 text-xs text-slate-500">({s.dims})</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>{shape === "cone" ? "Diameter (m)" : "Length (m)"}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.01"
                  required
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                />
              </div>
              {shape !== "cone" ? (
                <div>
                  <Label>Width (m)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    step="0.01"
                    required
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </div>
              ) : null}
              <div>
                <Label>Height (m)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.01"
                  required
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Estimate carries a ±25% band — accept or correct it on the next screen, exactly
              like a camera scan.
            </p>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || !materialId}>
              {busy ? "Computing…" : "Compute estimate"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
