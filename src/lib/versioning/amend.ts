import { Prisma, type RecordType, type AmendmentWindow, type AmendmentActor } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import type { AuthCtx } from "@/lib/auth/policies";
import { businessDateIST, isDayClosed } from "./day-close";

// ---------------------------------------------------------------------------
// The single write-path for versioned records. Creating is an INSERT of
// version 1; amending is an INSERT of version n+1 plus flipping the old row to
// superseded — inside one transaction — plus an edit_log row. Database
// triggers make any other mutation path impossible.
// ---------------------------------------------------------------------------

const VERSION_FIELDS = new Set([
  "id",
  "entityId",
  "version",
  "isCurrent",
  "status",
  "createdById",
  "createdAt",
  "amendmentReason",
  "amendedFromId",
]);

// System columns that must carry over unchanged on amendment (identity) —
// the caller cannot move a record to another site by amending it.
const PINNED_FIELDS: Record<RecordType, string[]> = {
  progress_entry: ["siteId"],
  measurement_book: ["siteId"],
  material_receipt: ["siteId"],
  consumption_entry: ["siteId"],
  requisition: ["siteId", "kind"],
  labour_entry: ["siteId", "entryType"],
};

// System fields excluded from the amendment diff (managed by machinery).
const DIFF_EXCLUDE: Record<RecordType, string[]> = {
  progress_entry: [],
  measurement_book: ["parseStatus", "rowErrors"],
  material_receipt: [],
  consumption_entry: [],
  requisition: [],
  labour_entry: [],
};

type DelegateName =
  | "progressEntry"
  | "measurementBook"
  | "materialReceipt"
  | "consumptionEntry"
  | "requisition"
  | "labourEntry";

export const RECORD_DELEGATE: Record<RecordType, DelegateName> = {
  progress_entry: "progressEntry",
  measurement_book: "measurementBook",
  material_receipt: "materialReceipt",
  consumption_entry: "consumptionEntry",
  requisition: "requisition",
  labour_entry: "labourEntry",
};

// Defaults per the approved edit-rights matrix; the owner can retune each in
// amendment_policies (seeded from this map).
export const DEFAULT_AMENDMENT_POLICIES: Record<
  RecordType,
  { allowedWindow: AmendmentWindow; allowedActor: AmendmentActor; enabled: boolean }
> = {
  material_receipt: { allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
  measurement_book: { allowedWindow: "same_day", allowedActor: "author", enabled: true },
  progress_entry: { allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
  consumption_entry: { allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
  requisition: { allowedWindow: "until_actioned", allowedActor: "author", enabled: true },
  labour_entry: { allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
};

type Row = Record<string, unknown> & {
  id: string;
  entityId: string;
  version: number;
  isCurrent: boolean;
  status: string;
  createdById: string;
  createdAt: Date;
  siteId: string;
};

function serialize(v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v as never;
}

export function computeDiff(
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>,
  exclude: string[] = []
): Record<string, { from: unknown; to: unknown }> {
  const skip = new Set([...VERSION_FIELDS, ...exclude]);
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const from = serialize(oldRow[key]);
    const to = serialize(newRow[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from, to };
    }
  }
  return diff;
}

async function getPolicy(recordType: RecordType) {
  const row = await prisma.amendmentPolicy.findUnique({ where: { recordType } });
  return row ?? { recordType, ...DEFAULT_AMENDMENT_POLICIES[recordType] };
}

async function assertWindowOpen(
  recordType: RecordType,
  window: AmendmentWindow,
  row: Row
): Promise<void> {
  const createdBusinessDate = businessDateIST(row.createdAt);

  switch (window) {
    case "never":
      throw new ApiError(403, "This record type does not allow amendments");
    case "same_day": {
      if (createdBusinessDate !== businessDateIST()) {
        throw new ApiError(403, "Amendment window closed: only allowed on the day of entry");
      }
      return;
    }
    case "until_day_close": {
      if (await isDayClosed(row.siteId, createdBusinessDate)) {
        throw new ApiError(
          403,
          "Amendment window closed: the business day has been closed"
        );
      }
      return;
    }
    case "until_actioned": {
      const latest = await prisma.approvalAction.findFirst({
        where: { requisitionEntityId: row.entityId },
        orderBy: { createdAt: "desc" },
      });
      // No action yet → freely editable. A query is an explicit request for
      // changes, so the author may respond with a new version; any other
      // decision freezes the request.
      if (latest && latest.action !== "queried") {
        throw new ApiError(
          403,
          "Amendment window closed: an approver has already acted on this request"
        );
      }
      return;
    }
  }
}

export interface AmendInput {
  recordType: RecordType;
  entityId: string;
  ctx: AuthCtx;
  actorRoleLabel: string; // "owner" | "engineer" | ... for the edit log
  reason: string;
  /** Full replacement business payload (validated by the caller's zod schema). */
  data: Record<string, unknown>;
}

/**
 * Amend a submitted record: authorization (owner always / author within the
 * owner-approved window), then new version + supersede + edit-log in one
 * transaction. Throws ApiError on any violation.
 */
export async function amendRecord(input: AmendInput): Promise<{ id: string; version: number }> {
  const { recordType, entityId, ctx, reason, data } = input;

  if (!reason || reason.trim().length < 5) {
    throw new ApiError(400, "A reason (min 5 characters) is mandatory for every amendment");
  }

  const delegate = RECORD_DELEGATE[recordType];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = prisma[delegate] as any;

  const current: Row | null = await model.findFirst({
    where: { entityId, isCurrent: true },
  });
  if (!current) throw new ApiError(404, "Record not found");
  if (current.status === "draft") {
    throw new ApiError(400, "Draft records are edited directly, not amended");
  }

  const policy = await getPolicy(recordType);

  if (!ctx.isOwner) {
    if (!policy.enabled) {
      throw new ApiError(403, "Amendments are disabled for this record type");
    }
    if (policy.allowedActor === "owner") {
      throw new ApiError(403, "Only the owner may amend this record type");
    }
    if (current.createdById !== ctx.userId) {
      throw new ApiError(403, "Only the original author may amend this record");
    }
    await assertWindowOpen(recordType, policy.allowedWindow, current);
  }

  // Build the new version: business payload over pinned identity fields.
  const businessData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (VERSION_FIELDS.has(key)) continue;
    businessData[key] = value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (VERSION_FIELDS.has(key)) continue;
    if (PINNED_FIELDS[recordType].includes(key)) continue; // identity never moves
    businessData[key] = value;
  }

  const result = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txModel = (tx as any)[delegate];

    const next = await txModel.create({
      data: {
        ...businessData,
        entityId,
        version: current.version + 1,
        isCurrent: false, // flipped after the old row is superseded (partial unique index)
        status: "submitted",
        createdById: ctx.userId,
        amendmentReason: reason.trim(),
        amendedFromId: current.id,
      },
    });

    await txModel.update({
      where: { id: current.id },
      data: { isCurrent: false, status: "superseded" },
    });

    await txModel.update({ where: { id: next.id }, data: { isCurrent: true } });

    const diff = computeDiff(current, next, DIFF_EXCLUDE[recordType]);

    await tx.editLog.create({
      data: {
        entityType: recordType,
        entityId,
        fromVersion: current.version,
        toVersion: next.version,
        actorId: ctx.userId,
        actorRole: input.actorRoleLabel,
        reason: reason.trim(),
        diff: diff as Prisma.InputJsonValue,
      },
    });

    return next;
  });

  return { id: result.id, version: result.version };
}

/**
 * Withdraw (void) a record where policy allows — modelled as an amendment to a
 * terminal superseded state with no successor? No: history must stay legible.
 * Phase 1 keeps withdrawal only for requisitions before pickup, implemented in
 * the requisition route as an amendment carrying a `withdrawn` marker line.
 */
export async function getAmendmentPolicies() {
  const rows = await prisma.amendmentPolicy.findMany();
  const byType = new Map(rows.map((r) => [r.recordType, r]));
  return (Object.keys(DEFAULT_AMENDMENT_POLICIES) as RecordType[]).map((rt) => ({
    recordType: rt,
    ...(byType.get(rt) ?? DEFAULT_AMENDMENT_POLICIES[rt]),
  }));
}
