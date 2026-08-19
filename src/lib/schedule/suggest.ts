import type { ActivityCategory } from "@prisma/client";
import { dayMultiplier, isMonsoonDay, type MonsoonConfig } from "./monsoon";

// Suggested schedule: forward pass over the dependency graph, walking calendar
// days with monsoon-derated productivity. Pure — fully unit-testable.

export interface ScheduleActivityInput {
  id: string;
  category: ActivityCategory;
  boqQty: number | null;
  normPerDay: number | null;
  sequence: number;
}

export interface DependencyInput {
  predecessorId: string;
  successorId: string;
  lagDays: number;
}

export interface SuggestedActivityDates {
  activityId: string;
  suggStart: string; // yyyy-mm-dd
  suggEnd: string;
  durationDays: number;
  monsoonAffected: boolean;
  effectiveMultiplier: number;
}

const DEFAULT_DURATION_DAYS = 7;
const MAX_DURATION_DAYS = 1500; // hard stop against degenerate norm inputs

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Topological order (Kahn). Throws on dependency cycles, naming the cycle members. */
export function topologicalOrder(
  activities: ScheduleActivityInput[],
  dependencies: DependencyInput[]
): string[] {
  const ids = new Set(activities.map((a) => a.id));
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);
  for (const dep of dependencies) {
    if (!ids.has(dep.predecessorId) || !ids.has(dep.successorId)) continue;
    indegree.set(dep.successorId, (indegree.get(dep.successorId) ?? 0) + 1);
    const list = successors.get(dep.predecessorId) ?? [];
    list.push(dep.successorId);
    successors.set(dep.predecessorId, list);
  }

  // Stable order among ready nodes: by declared sequence.
  const seqById = new Map(activities.map((a) => [a.id, a.sequence]));
  const ready = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => (seqById.get(a) ?? 0) - (seqById.get(b) ?? 0));
    const id = ready.shift()!;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) ready.push(next);
    }
  }

  if (order.length !== ids.size) {
    const stuck = [...ids].filter((id) => !order.includes(id));
    throw new Error(`Dependency cycle detected among activities: ${stuck.join(", ")}`);
  }
  return order;
}

/**
 * Walk calendar days from `startIso`, accumulating derated daily output until
 * the BOQ qty is met. Returns the end date and whether monsoon touched it.
 */
export function walkDuration(
  startIso: string,
  activity: ScheduleActivityInput,
  config: MonsoonConfig
): { endIso: string; durationDays: number; monsoonAffected: boolean; effectiveMultiplier: number } {
  const qty = activity.boqQty ?? 0;
  const norm = activity.normPerDay ?? 0;

  if (qty <= 0 || norm <= 0) {
    // No quantity basis — fixed default duration, still monsoon-marked.
    let monsoonAffected = false;
    for (let i = 0; i < DEFAULT_DURATION_DAYS; i++) {
      if (isMonsoonDay(new Date(addDays(startIso, i)), config)) monsoonAffected = true;
    }
    return {
      endIso: addDays(startIso, DEFAULT_DURATION_DAYS - 1),
      durationDays: DEFAULT_DURATION_DAYS,
      monsoonAffected,
      effectiveMultiplier: 1,
    };
  }

  let done = 0;
  let day = 0;
  let monsoonAffected = false;
  let multiplierSum = 0;
  while (done < qty && day < MAX_DURATION_DAYS) {
    const date = new Date(addDays(startIso, day));
    const multiplier = dayMultiplier(date, activity.category, config);
    if (multiplier < 1) monsoonAffected = true;
    multiplierSum += multiplier;
    done += norm * multiplier;
    day += 1;
  }
  return {
    endIso: addDays(startIso, day - 1),
    durationDays: day,
    monsoonAffected,
    effectiveMultiplier: day > 0 ? multiplierSum / day : 1,
  };
}

export function suggestSchedule(input: {
  siteStartIso: string;
  activities: ScheduleActivityInput[];
  dependencies: DependencyInput[];
  config: MonsoonConfig;
}): SuggestedActivityDates[] {
  const order = topologicalOrder(input.activities, input.dependencies);
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const predecessorsOf = new Map<string, DependencyInput[]>();
  for (const dep of input.dependencies) {
    const list = predecessorsOf.get(dep.successorId) ?? [];
    list.push(dep);
    predecessorsOf.set(dep.successorId, list);
  }

  const endById = new Map<string, string>();
  const results: SuggestedActivityDates[] = [];

  for (const id of order) {
    const activity = byId.get(id)!;
    let start = input.siteStartIso;
    for (const dep of predecessorsOf.get(id) ?? []) {
      const predEnd = endById.get(dep.predecessorId);
      if (!predEnd) continue;
      const candidate = addDays(predEnd, 1 + dep.lagDays); // FS + lag
      if (candidate > start) start = candidate;
    }
    const walked = walkDuration(start, activity, input.config);
    endById.set(id, walked.endIso);
    results.push({
      activityId: id,
      suggStart: start,
      suggEnd: walked.endIso,
      durationDays: walked.durationDays,
      monsoonAffected: walked.monsoonAffected,
      effectiveMultiplier: Number(walked.effectiveMultiplier.toFixed(2)),
    });
  }
  return results;
}
