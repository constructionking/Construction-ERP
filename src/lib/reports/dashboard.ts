import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/versioning/day-close";
import { getCurrentBaseline } from "@/lib/schedule/service";
import { deriveState } from "@/lib/requisitions";
import type { SCurvePoint } from "@/components/viz/SCurve";
import type { HeatRow } from "@/components/viz/DelayHeatmap";
import type { ManpowerDay } from "@/components/viz/ManpowerChart";
import type { FundStage } from "@/components/viz/FundFlowBar";

// Dashboard data assembly. Derived, read-only views over existing records —
// nothing here writes. Progress weighting uses planned DURATION days from the
// locked baseline (honest without money rates: a 30-day trade moves the site
// more than a 2-day one; mixed units make quantity sums meaningless).

const DAY_MS = 86_400_000;

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface WeightedActivity {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  plannedStart: string;
  plannedEnd: string;
  weight: number; // planned days
  boq: number; // planned qty (0 = unknown)
}

async function loadWeighted(siteId: string): Promise<{
  acts: WeightedActivity[];
  progress: Array<{ activityId: string; date: string; qty: number }>;
} | null> {
  const baseline = await getCurrentBaseline(siteId);
  if (!baseline || baseline.activities.length === 0) return null;
  const activityRows = await prisma.activity.findMany({
    where: { siteId, isGroup: false },
    select: { id: true, code: true, name: true, parentId: true, boqQty: true },
  });
  const byId = new Map(activityRows.map((a) => [a.id, a]));
  const acts: WeightedActivity[] = [];
  for (const b of baseline.activities) {
    const a = byId.get(b.activityId);
    if (!a) continue; // orphan from a reset — null-safe by design
    const start = dateOnly(b.plannedStart);
    const end = dateOnly(b.plannedEnd);
    const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS) + 1);
    acts.push({
      id: a.id,
      code: a.code,
      name: a.name,
      parentId: a.parentId,
      plannedStart: start,
      plannedEnd: end,
      weight: days,
      boq: Number(b.plannedQty ?? a.boqQty ?? 0),
    });
  }
  if (acts.length === 0) return null;
  const entries = await prisma.progressEntry.findMany({
    where: { siteId, isCurrent: true, status: "submitted" },
    select: { activityId: true, entryDate: true, qtyDone: true },
    orderBy: { entryDate: "asc" },
  });
  return {
    acts,
    progress: entries.map((e) => ({
      activityId: e.activityId,
      date: dateOnly(e.entryDate),
      qty: Number(e.qtyDone),
    })),
  };
}

function plannedFraction(a: WeightedActivity, atIso: string): number {
  if (atIso < a.plannedStart) return 0;
  if (atIso >= a.plannedEnd) return 1;
  const total = new Date(a.plannedEnd).getTime() - new Date(a.plannedStart).getTime() || 1;
  return (new Date(atIso).getTime() - new Date(a.plannedStart).getTime()) / total;
}

function actualFraction(
  a: WeightedActivity,
  atIso: string,
  progressByActivity: Map<string, Array<{ date: string; qty: number }>>,
): number {
  if (a.boq <= 0) return 0;
  const rows = progressByActivity.get(a.id) ?? [];
  let done = 0;
  for (const r of rows) if (r.date <= atIso) done += r.qty;
  return Math.min(1, done / a.boq);
}

function indexProgress(progress: Array<{ activityId: string; date: string; qty: number }>) {
  const map = new Map<string, Array<{ date: string; qty: number }>>();
  for (const p of progress) {
    const list = map.get(p.activityId) ?? [];
    list.push(p);
    map.set(p.activityId, list);
  }
  return map;
}

/** Weekly S-curve points from baseline start to max(today, baseline end). */
export async function sCurve(siteId: string, todayIso: string): Promise<SCurvePoint[]> {
  const data = await loadWeighted(siteId);
  if (!data) return [];
  const { acts, progress } = data;
  const byActivity = indexProgress(progress);
  const totalW = acts.reduce((s, a) => s + a.weight, 0);
  let start = acts.reduce((m, a) => (a.plannedStart < m ? a.plannedStart : m), acts[0].plannedStart);
  let end = acts.reduce((m, a) => (a.plannedEnd > m ? a.plannedEnd : m), acts[0].plannedEnd);
  if (end < todayIso) end = todayIso;

  const points: SCurvePoint[] = [];
  for (let d = start; d <= end; d = isoAddDays(d, 7)) {
    const planned =
      (acts.reduce((s, a) => s + a.weight * plannedFraction(a, d), 0) / totalW) * 100;
    const actual =
      d > todayIso
        ? null
        : (acts.reduce((s, a) => s + a.weight * actualFraction(a, d, byActivity), 0) / totalW) * 100;
    points.push({ date: d, planned, actual });
  }
  // Ensure the final baseline point is present.
  if (points.length === 0 || points[points.length - 1].date < end) {
    const planned = (acts.reduce((s, a) => s + a.weight * plannedFraction(a, end), 0) / totalW) * 100;
    points.push({
      date: end,
      planned,
      actual:
        end > todayIso
          ? null
          : (acts.reduce((s, a) => s + a.weight * actualFraction(a, end, byActivity), 0) / totalW) * 100,
    });
  }
  return points;
}

/** Delay heatmap rows: main activity × week, delta in percentage points. */
export async function delayHeatmap(siteId: string, todayIso: string): Promise<HeatRow[]> {
  const data = await loadWeighted(siteId);
  if (!data) return [];
  const { acts, progress } = data;
  const byActivity = indexProgress(progress);
  const parents = await prisma.activity.findMany({
    where: { siteId, isGroup: true },
    orderBy: { sequence: "asc" },
    select: { id: true, name: true },
  });
  const groups: Array<{ name: string; acts: WeightedActivity[] }> = parents
    .map((p) => ({ name: p.name, acts: acts.filter((a) => a.parentId === p.id) }))
    .filter((g) => g.acts.length > 0);
  const orphans = acts.filter((a) => !a.parentId || !parents.some((p) => p.id === a.parentId));
  if (orphans.length > 0) groups.push({ name: "Other items", acts: orphans });
  if (groups.length === 0) return [];

  const start = acts.reduce((m, a) => (a.plannedStart < m ? a.plannedStart : m), acts[0].plannedStart);
  const weeks: string[] = [];
  for (let d = start; d <= todayIso; d = isoAddDays(d, 7)) weeks.push(d);
  if (weeks.length === 0) weeks.push(start);

  return groups.map((g) => {
    const totalW = g.acts.reduce((s, a) => s + a.weight, 0) || 1;
    return {
      structure: g.name,
      cells: weeks.map((w) => {
        const wEnd = isoAddDays(w, 6);
        const started = g.acts.some((a) => a.plannedStart <= wEnd);
        if (!started) return { week: w, deltaPp: null, worstItems: [] };
        const planned = g.acts.reduce((s, a) => s + a.weight * plannedFraction(a, wEnd), 0) / totalW;
        const actual =
          g.acts.reduce((s, a) => s + a.weight * actualFraction(a, wEnd, byActivity), 0) / totalW;
        const deltaPp = (actual - planned) * 100;
        const worstItems = g.acts
          .map((a) => ({
            a,
            gap: plannedFraction(a, wEnd) - actualFraction(a, wEnd, byActivity),
          }))
          .filter((x) => x.gap > 0.1)
          .sort((x, y) => y.gap - x.gap)
          .slice(0, 3)
          .map((x) => `${x.a.code} ${x.a.name.slice(0, 30)}`);
        return { week: w, deltaPp, worstItems };
      }),
    };
  });
}

/** Overall duration-weighted progress % (null without a baseline). */
export async function overallProgressPct(siteId: string, todayIso: string): Promise<number | null> {
  const points = await sCurve(siteId, todayIso);
  const withActual = points.filter((p) => p.actual !== null);
  if (withActual.length === 0) return null;
  return withActual[withActual.length - 1].actual;
}

/** Fund pipeline stages by derived state + total requested. */
export async function fundPipeline(siteId: string): Promise<{ stages: FundStage[] }> {
  const requisitions = await prisma.requisition.findMany({
    where: { siteId, kind: "fund", isCurrent: true, status: "submitted" },
    select: { entityId: true, createdAt: true, amountTotal: true },
  });
  const actions = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: { in: requisitions.map((r) => r.entityId) } },
    select: { requisitionEntityId: true, action: true, createdAt: true, approvedAmount: true },
  });
  const byEntity = new Map<string, typeof actions>();
  for (const a of actions) {
    const list = byEntity.get(a.requisitionEntityId) ?? [];
    list.push(a);
    byEntity.set(a.requisitionEntityId, list);
  }
  const sums = { released: 0, awaiting_release: 0, awaiting_owner: 0, with_accounts: 0 };
  for (const r of requisitions) {
    const state = deriveState("fund", r, byEntity.get(r.entityId) ?? []);
    const amount = Number(r.amountTotal ?? 0);
    if (state === "released") sums.released += amount;
    else if (state === "awaiting_release") sums.awaiting_release += amount;
    else if (state === "awaiting_owner") sums.awaiting_owner += amount;
    else if (state === "pending" || state === "resubmitted" || state === "queried")
      sums.with_accounts += amount;
    // rejected / changes_requested are out of the live pipeline
  }
  return {
    stages: [
      { key: "released", label: "Released", amount: sums.released },
      { key: "awaiting_release", label: "Awaiting release", amount: sums.awaiting_release },
      { key: "awaiting_owner", label: "With you", amount: sums.awaiting_owner },
      { key: "with_accounts", label: "With accounts", amount: sums.with_accounts },
    ],
  };
}

/** Everything that happened on site TODAY — the trust strip. */
export async function todayOnSite(siteId: string, todayIso: string) {
  const dayStart = new Date(`${todayIso}T00:00:00+05:30`);
  const [labour, progressEntries, photos, mb, receipts] = await Promise.all([
    prisma.labourEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted", entryDate: new Date(todayIso) },
      select: { workersCount: true },
    }),
    prisma.progressEntry.findMany({
      where: { siteId, isCurrent: true, status: "submitted", entryDate: new Date(todayIso) },
      select: { activityId: true },
    }),
    prisma.photo.count({ where: { siteId, createdAt: { gte: dayStart } } }),
    prisma.measurementBook.findFirst({
      where: { siteId, isCurrent: true, mbDate: new Date(todayIso) },
      select: { sheetNo: true },
    }),
    prisma.materialReceipt.count({
      where: { siteId, isCurrent: true, status: "submitted", receivedDate: new Date(todayIso) },
    }),
  ]);
  const workers = labour.reduce((s, l) => s + l.workersCount, 0);
  const activitiesTouched = new Set(progressEntries.map((p) => p.activityId)).size;
  return {
    workers,
    activitiesTouched,
    photos,
    mbSheet: mb?.sheetNo ?? null,
    receipts,
    quiet: workers === 0 && activitiesTouched === 0 && photos === 0 && !mb && receipts === 0,
  };
}

/** Daily manpower for the last N days (day-rate entries). */
export async function manpowerSeries(siteId: string, todayIso: string, days: number): Promise<ManpowerDay[]> {
  const from = isoAddDays(todayIso, -(days - 1));
  const rows = await prisma.labourEntry.groupBy({
    by: ["entryDate"],
    where: {
      siteId,
      isCurrent: true,
      status: "submitted",
      entryType: "day_rate",
      entryDate: { gte: new Date(from) },
    },
    _sum: { workersCount: true },
  });
  const byDate = new Map(rows.map((r) => [dateOnly(r.entryDate!), Number(r._sum.workersCount ?? 0)]));
  const out: ManpowerDay[] = [];
  for (let d = from; d <= todayIso; d = isoAddDays(d, 1)) {
    out.push({ date: d, workers: byDate.get(d) ?? 0 });
  }
  return out;
}

/** Weekly actual-progress trend (last 8 points) for KPI sparklines. */
export async function progressTrend(siteId: string, todayIso: string): Promise<number[]> {
  const points = await sCurve(siteId, todayIso);
  return points
    .filter((p) => p.actual !== null)
    .slice(-8)
    .map((p) => p.actual!);
}

export interface ApprovalInboxRow {
  siteId: string;
  siteName: string;
  kind: "fund" | "material";
  amount: number | null;
  justification: string;
  waitingDays: number;
  blockedOn: "you" | "accounts";
  bucket: "overdue" | "week" | "later"; // aging: >7d / ≤7d / fresh (≤2d)
}

/** Cross-site approval inbox with amounts and aging buckets. */
export async function approvalInbox(now: Date): Promise<ApprovalInboxRow[]> {
  const requisitions = await prisma.requisition.findMany({
    where: { isCurrent: true, status: "submitted" },
    select: {
      entityId: true,
      siteId: true,
      kind: true,
      amountTotal: true,
      justification: true,
      createdAt: true,
    },
  });
  if (requisitions.length === 0) return [];
  const sites = await prisma.site.findMany({
    where: { id: { in: [...new Set(requisitions.map((r) => r.siteId))] } },
    select: { id: true, name: true },
  });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const actions = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: { in: requisitions.map((r) => r.entityId) } },
    select: { requisitionEntityId: true, action: true, createdAt: true },
  });
  const byEntity = new Map<string, typeof actions>();
  for (const a of actions) {
    const list = byEntity.get(a.requisitionEntityId) ?? [];
    list.push(a);
    byEntity.set(a.requisitionEntityId, list);
  }
  const rows: ApprovalInboxRow[] = [];
  for (const r of requisitions) {
    const acts = byEntity.get(r.entityId) ?? [];
    const state = deriveState(r.kind as "fund" | "material", r, acts);
    let blockedOn: "you" | "accounts" | null = null;
    if (r.kind === "fund") {
      if (state === "awaiting_owner") blockedOn = "you";
      else if (state === "pending" || state === "resubmitted" || state === "awaiting_release")
        blockedOn = "accounts";
    } else if (state === "pending" || state === "resubmitted") {
      blockedOn = "you"; // material requests are owner-decided
    }
    if (!blockedOn) continue;
    const since = acts.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), r.createdAt);
    const waitingDays = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    rows.push({
      siteId: r.siteId,
      siteName: siteName.get(r.siteId) ?? "?",
      kind: r.kind as "fund" | "material",
      amount: r.amountTotal !== null ? Number(r.amountTotal) : null,
      justification: r.justification,
      waitingDays,
      blockedOn,
      bucket: waitingDays > 7 ? "overdue" : waitingDays > 2 ? "week" : "later",
    });
  }
  rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || b.waitingDays - a.waitingDays);
  return rows;
}

/** Age (days) of the most recent record of any kind on a site. */
export async function lastUpdateAgeDays(siteId: string, now: Date): Promise<number | null> {
  const [p, ph, mbook, lab] = await Promise.all([
    prisma.progressEntry.findFirst({ where: { siteId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.photo.findFirst({ where: { siteId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.measurementBook.findFirst({ where: { siteId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.labourEntry.findFirst({ where: { siteId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const latest = [p, ph, mbook, lab]
    .map((r) => r?.createdAt.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  if (latest === 0) return null;
  return Math.floor((now.getTime() - latest) / DAY_MS);
}
