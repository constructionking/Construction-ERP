"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";

interface ActivityOption {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  parent?: { name: string } | null; // main activity this item sits under
}

// Group options under their main activity for a scannable dropdown.
function groupByParent(activities: ActivityOption[]) {
  const groups = new Map<string, ActivityOption[]>();
  for (const a of activities) {
    const key = a.parent?.name ?? "";
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  return [...groups.entries()];
}

async function uploadPhoto(
  file: File,
  meta: { siteId: string; activityId?: string }
): Promise<string> {
  const geo = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });

  const form = new FormData();
  form.set("file", file);
  form.set("siteId", meta.siteId);
  if (meta.activityId) form.set("activityId", meta.activityId);
  form.set("kind", "progress");
  form.set("takenAt", new Date().toISOString());
  if (geo) {
    form.set("geoLat", String(geo.coords.latitude));
    form.set("geoLng", String(geo.coords.longitude));
    form.set("geoAccuracy", String(geo.coords.accuracy));
  }
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json()).error ?? "Photo upload failed");
  return (await res.json()).photo.id;
}

export function ProgressForm({
  siteId,
  today,
  activities,
}: {
  siteId: string;
  today: string;
  activities: ActivityOption[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activityId, setActivityId] = useState("");
  const [qty, setQty] = useState("");
  const [executedBy, setExecutedBy] = useState<"dept" | "contractor">("contractor");
  const [contractorName, setContractorName] = useState("");
  const [notes, setNotes] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const activity = activities.find((a) => a.id === activityId);

  async function onPhotosSelected(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        await uploadPhoto(file, { siteId, activityId: activityId || undefined });
        setPhotoCount((c) => c + 1);
      }
      setMsg({ kind: "ok", text: "Photo uploaded — it is now part of the site record" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activity) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          activityId,
          entryDate: today,
          qtyDone: Number(qty),
          unit: activity.unit ?? "CUM",
          executedBy,
          contractorName: executedBy === "contractor" ? contractorName : undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not submit" });
        return;
      }
      setMsg({
        kind: "ok",
        text: "Submitted. Entries lock at day close — amend today with a reason if needed.",
      });
      setQty("");
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="activity">Activity</Label>
        <Select
          id="activity"
          value={activityId}
          onChange={(e) => setActivityId(e.target.value)}
          required
        >
          <option value="">Select activity…</option>
          {groupByParent(activities).map(([groupName, items]) =>
            groupName ? (
              <optgroup key={groupName} label={groupName}>
                {items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </optgroup>
            ) : (
              items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))
            ),
          )}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="qty">Qty done {activity?.unit ? `(${activity.unit})` : ""}</Label>
          <Input
            id="qty"
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
          <Label htmlFor="executedBy">Executed by</Label>
          <Select
            id="executedBy"
            value={executedBy}
            onChange={(e) => setExecutedBy(e.target.value as "dept" | "contractor")}
          >
            <option value="contractor">Contractor</option>
            <option value="dept">Departmental</option>
          </Select>
        </div>
      </div>

      {executedBy === "contractor" ? (
        <div>
          <Label htmlFor="contractor">Contractor name</Label>
          <Input
            id="contractor"
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            required
          />
        </div>
      ) : null}

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => onPhotosSelected(e.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          📷 Add photo{photoCount ? ` (${photoCount})` : ""}
        </Button>
        <Button type="submit" disabled={busy || !activityId} className="flex-1">
          {busy ? "Working…" : "Submit entry"}
        </Button>
      </div>

      {msg ? (
        <p
          className={
            msg.kind === "ok"
              ? "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          }
        >
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
