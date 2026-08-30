"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui";

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

interface ActivityInfo {
  id: string;
  code: string;
  name: string;
  isGroup?: boolean;
  parentId?: string | null;
  category: string;
  boqQty: string | null;
  unit: string | null;
  norm: string | null;
}

interface SuggestionData {
  generatedAt: string;
  dates: Array<{
    activityId: string;
    suggStart: string;
    suggEnd: string;
    monsoonAffected: boolean;
  }>;
}

// The owner flow the spec demands: the app SUGGESTS dates (monsoon-derated),
// the owner reviews each one — accepting or correcting — then LOCKS. Only the
// locked baseline governs delay measurement.
export function ScheduleReview({
  siteId,
  activities,
  suggestion,
  hasBaseline,
  siteStartDate,
}: {
  siteId: string;
  activities: ActivityInfo[];
  suggestion: SuggestionData | null;
  hasBaseline: boolean;
  siteStartDate: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  // Owner picks ONE date; the model computes everything forward from it.
  const [startDate, setStartDate] = useState(siteStartDate ?? todayIST());

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/schedule/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startDate ? { startDate } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not generate a suggestion");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function startReview() {
    if (!suggestion) return;
    const initial: Record<string, { start: string; end: string }> = {};
    for (const date of suggestion.dates) {
      initial[date.activityId] = { start: date.suggStart, end: date.suggEnd };
    }
    setDates(initial);
    setReviewing(true);
  }

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activities: Object.entries(dates).map(([activityId, d]) => ({
            activityId,
            plannedStart: d.start,
            plannedEnd: d.end,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not lock the baseline");
        return;
      }
      setReviewing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const suggestionByActivity = new Map(
    (suggestion?.dates ?? []).map((d) => [d.activityId, d])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {hasBaseline ? "Re-plan (creates baseline v+1)" : "Plan & lock the baseline"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">
          Pick the project start date — the app models every activity&apos;s dates forward from
          it (BOQ quantity ÷ daily productivity norm, walking the dependency chain and slowing
          work through monsoon months, June–September). All dates come pre-filled; correct only
          the ones you disagree with, then lock. After lock-in the dates are followed and cannot
          be edited.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Project start date</Label>
            <Input
              type="date"
              className="w-44"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <Button variant="secondary" disabled={busy || !startDate} onClick={generate}>
            {busy ? "Working…" : suggestion ? "Re-model from this date" : "Suggest schedule"}
          </Button>
          {suggestion && !reviewing ? (
            <Button disabled={busy} onClick={startReview}>
              Review & lock…
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {reviewing ? (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Activity</th>
                    <th className="px-3 py-2 text-left">Suggested</th>
                    <th className="px-3 py-2 text-left">Start (edit to correct)</th>
                    <th className="px-3 py-2 text-left">End</th>
                  </tr>
                </thead>
                <tbody>
                  {activities
                    .filter((a) => dates[a.id] || (a.isGroup && activities.some((c) => c.parentId === a.id && dates[c.id])))
                    .map((activity) => {
                      // Main activities are headings here — their bars derive
                      // from the children; only leaves carry editable dates.
                      if (activity.isGroup) {
                        return (
                          <tr key={activity.id} className="border-t border-slate-200 bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-800" colSpan={4}>
                              {activity.name}
                            </td>
                          </tr>
                        );
                      }
                      const suggested = suggestionByActivity.get(activity.id);
                      return (
                        <tr key={activity.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <span className={activity.parentId ? "pl-4 font-medium" : "font-medium"}>{activity.code}</span>{" "}
                            <span className="text-slate-500">{activity.name}</span>
                            {suggested?.monsoonAffected ? (
                              <Badge tone="blue" className="ml-1.5">
                                ☔ monsoon-adjusted
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">
                            {suggested ? `${suggested.suggStart} → ${suggested.suggEnd}` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="date"
                              className="w-40"
                              value={dates[activity.id].start}
                              onChange={(e) =>
                                setDates((d) => ({
                                  ...d,
                                  [activity.id]: { ...d[activity.id], start: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="date"
                              className="w-40"
                              value={dates[activity.id].end}
                              onChange={(e) =>
                                setDates((d) => ({
                                  ...d,
                                  [activity.id]: { ...d[activity.id], end: e.target.value },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setReviewing(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={lock}>
                {busy ? "Locking…" : "🔒 Lock baseline — dates become final"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
