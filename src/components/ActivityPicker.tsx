"use client";

import { useEffect, useMemo, useState } from "react";
import { Label, Select } from "@/components/ui";

// Two-level work-item picker for site forms: choose the MAIN activity
// (structure — UGT, boundary wall…) first, then the sub-activity under it.
// Ungrouped items sit under an "Other items" heading. Value is always the
// sub-activity (leaf) id — headings are never a valid target.

export interface PickerActivity {
  id: string;
  code: string;
  name: string;
  unit?: string | null;
  parent?: { id: string; name: string } | null;
}

const OTHER = "__other";

export function ActivityPicker({
  activities,
  value,
  onChange,
  required,
  idPrefix = "activity",
  compact,
}: {
  activities: PickerActivity[];
  value: string;
  onChange: (activityId: string) => void;
  required?: boolean;
  idPrefix?: string;
  compact?: boolean;
}) {
  const groups = useMemo(() => {
    const byParent = new Map<string, { name: string; items: PickerActivity[] }>();
    for (const a of activities) {
      const key = a.parent?.id ?? OTHER;
      const entry = byParent.get(key) ?? { name: a.parent?.name ?? "Other items", items: [] };
      entry.items.push(a);
      byParent.set(key, entry);
    }
    // Main activities in first-seen (sequence) order; "Other items" last.
    const list = [...byParent.entries()];
    list.sort((x, y) => (x[0] === OTHER ? 1 : 0) - (y[0] === OTHER ? 1 : 0));
    return list;
  }, [activities]);

  const selected = activities.find((a) => a.id === value);
  const [mainId, setMainId] = useState<string>(selected ? selected.parent?.id ?? OTHER : "");

  // Keep the main selection in step when the value is set from outside.
  useEffect(() => {
    if (selected) setMainId(selected.parent?.id ?? OTHER);
  }, [selected]);

  const subItems = groups.find(([key]) => key === mainId)?.[1].items ?? [];
  const singleGroup = groups.length === 1;

  return (
    <div className={compact ? "grid grid-cols-1 gap-2" : "grid grid-cols-1 gap-3"}>
      {!singleGroup ? (
        <div>
          <Label htmlFor={`${idPrefix}-main`}>Main activity</Label>
          <Select
            id={`${idPrefix}-main`}
            value={mainId}
            onChange={(e) => {
              setMainId(e.target.value);
              onChange("");
            }}
            required={required}
          >
            <option value="">Select main activity…</option>
            {groups.map(([key, g]) => (
              <option key={key} value={key}>
                {g.name}
                {` (${g.items.length})`}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div>
        <Label htmlFor={`${idPrefix}-sub`}>
          {singleGroup ? "Activity" : "Sub-activity"}
        </Label>
        <Select
          id={`${idPrefix}-sub`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={!singleGroup && !mainId}
        >
          <option value="">
            {singleGroup || mainId ? "Select sub-activity…" : "Pick the main activity first"}
          </option>
          {(singleGroup ? groups[0]?.[1].items ?? [] : subItems).map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
              {a.unit ? ` (${a.unit})` : ""}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
