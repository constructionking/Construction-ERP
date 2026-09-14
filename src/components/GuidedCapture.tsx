"use client";

// Guided camera capture with LIVE coaching: the engineer sees, in real time,
// whether the shot is bright enough, sharp enough and held at the right angle
// for the app to read it — plus a per-material checklist. Pure browser
// (canvas + DeviceOrientation), no ML, works offline.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export type CaptureMode = "steel" | "heap";

export const CAPTURE_TIPS: Record<CaptureMode, { title: string; steps: string[] }> = {
  steel: {
    title: "Photograph the END of the bundle",
    steps: [
      "Stand square to the cut ends so every bar shows as a circle.",
      "Fill the frame with the bundle face; keep all ends inside the frame.",
      "Hold the phone upright and level — arrows go green when the angle is right.",
      "Put a ₹10 coin or a tape on the bundle face for scale (helps the diameter check).",
      "Daylight or torch ON — no long shadows across the ends.",
    ],
  },
  heap: {
    title: "Capture the delivered heap",
    steps: [
      "Place the printed marker board flat against the base of the heap.",
      "Keep the WHOLE heap in frame with some ground around it.",
      "Walk a slow circle 3–5 m away, one shot every couple of steps.",
      "Avoid shooting into the sun; keep the phone steady between shots.",
    ],
  },
};

export interface FrameQuality {
  luma: number; // 0–255 mean brightness
  sharpness: number; // gradient energy, higher = sharper
  light: "dark" | "ok" | "bright";
  sharp: boolean;
}

/** Cheap per-frame quality read on a downscaled canvas (≈ 20 ms on a phone). */
export function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameQuality | null {
  const w = 160;
  const h = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || video.readyState < 2) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sum += y;
  }
  const luma = sum / (w * h);
  // Mean absolute Laplacian-ish response: blurry frames have little edge energy.
  let energy = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      energy += Math.abs(lap);
      n++;
    }
  }
  const sharpness = n ? energy / n : 0;
  return {
    luma,
    sharpness,
    light: luma < 55 ? "dark" : luma > 215 ? "bright" : "ok",
    sharp: sharpness > 6,
  };
}

export function GuidedCapture({
  mode,
  onCapture,
  onClose,
  captureLabel = "📸 Capture",
}: {
  mode: CaptureMode;
  onCapture: (file: File) => void | Promise<void>;
  onClose: () => void;
  captureLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const probeRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [tilt, setTilt] = useState<{ beta: number; gamma: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1440 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera unavailable — use the gallery instead");
      }
    })();
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta !== null && e.gamma !== null) setTilt({ beta: e.beta, gamma: e.gamma });
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      cancelled = true;
      window.removeEventListener("deviceorientation", onOrient);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const probe = probeRef.current ?? document.createElement("canvas");
    probeRef.current = probe;
    const id = window.setInterval(() => {
      if (videoRef.current) setQuality(analyzeFrame(videoRef.current, probe));
    }, 450);
    return () => window.clearInterval(id);
  }, [ready]);

  // Angle coaching: steel wants the phone upright & square (beta ≈ 90°, gamma ≈ 0°);
  // a heap wants a gentle downward look (beta 45–80°). Unknown when no sensor.
  const angleOk =
    tilt === null
      ? null
      : mode === "steel"
        ? Math.abs(tilt.beta - 90) < 20 && Math.abs(tilt.gamma) < 12
        : tilt.beta > 35 && tilt.beta < 85 && Math.abs(tilt.gamma) < 15;
  const angleHint =
    tilt === null
      ? "Angle: sensor n/a"
      : angleOk
        ? "Angle ✓"
        : mode === "steel"
          ? tilt.beta < 70
            ? "Tilt phone UP"
            : tilt.beta > 110
              ? "Tilt phone DOWN"
              : "Level the phone"
          : tilt.beta >= 85
            ? "Look DOWN at the heap"
            : "Raise the phone";

  const lightOk = quality?.light === "ok";
  const sharpOk = quality?.sharp ?? false;
  const allGood = lightOk && sharpOk && angleOk !== false;

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("Capture failed");
      await onCapture(new File([blob], `${mode}-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  const tips = CAPTURE_TIPS[mode];
  const pill = (ok: boolean | null, label: string) => (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        ok === null ? "bg-slate-200 text-slate-600" : ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      )}
    >
      {label}
    </span>
  );

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">{tips.title}</p>
        <button type="button" className="text-xs text-slate-500" onClick={onClose}>
          ✕ close
        </button>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
        {tips.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="relative overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
        {mode === "steel" ? (
          // Framing guide: keep the bundle face inside this box.
          <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/70" />
        ) : null}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {pill(quality ? lightOk : null, quality ? (quality.light === "dark" ? "Too dark — add light" : quality.light === "bright" ? "Too bright — shade it" : "Light ✓") : "Light …")}
          {pill(quality ? sharpOk : null, quality ? (sharpOk ? "Sharp ✓" : "Hold steady / focus") : "Focus …")}
          {pill(angleOk, angleHint)}
        </div>
        {allGood ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white">
            Good shot — capture now
          </div>
        ) : null}
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" className="flex-1" disabled={!ready || busy} onClick={capture}>
          {busy ? "…" : captureLabel}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onCapture(f);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          Gallery
        </Button>
      </div>
    </div>
  );
}
