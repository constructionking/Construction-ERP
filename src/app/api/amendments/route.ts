import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx, ApiError } from "@/lib/auth/guard";
import { amendRecord, RECORD_DELEGATE } from "@/lib/versioning/amend";
import { AMENDABLE_VIA_API } from "@/lib/versioning/schemas";

const bodySchema = z.object({
  recordType: z.enum([
    "progress_entry",
    "material_receipt",
    "consumption_entry",
    "requisition",
    "labour_entry",
  ]),
  entityId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
  data: z.record(z.string(), z.unknown()),
});

export const POST = withApi(async (req: NextRequest) => {
  const body = bodySchema.parse(await req.json());

  // Locate the record to learn its site, then authorize against that site —
  // never against a site id supplied by the client.
  const delegate = RECORD_DELEGATE[body.recordType];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = await (prisma[delegate] as any).findFirst({
    where: { entityId: body.entityId, isCurrent: true },
    select: { siteId: true },
  });
  if (!current) throw new ApiError(404, "Record not found");

  const ctx = await guard("record.amend", { siteId: current.siteId });

  const schema = AMENDABLE_VIA_API[body.recordType];
  if (!schema) throw new ApiError(400, "This record type cannot be amended via this endpoint");
  const data = schema.parse({ ...body.data, siteId: current.siteId });

  const actorRoleLabel = ctx.isOwner
    ? "owner"
    : (ctx.siteRoles.get(current.siteId) ?? "unknown");

  const result = await amendRecord({
    recordType: body.recordType,
    entityId: body.entityId,
    ctx,
    actorRoleLabel,
    reason: body.reason,
    data,
  });

  return NextResponse.json({ ok: true, ...result });
});

// Amendment history for a record (author or any site member can view own site's).
export const GET = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const url = new URL(req.url);
  const entityId = z.string().uuid().parse(url.searchParams.get("entityId"));

  const logs = await prisma.editLog.findMany({
    where: { entityId },
    orderBy: { createdAt: "asc" },
  });
  if (logs.length === 0) return NextResponse.json({ logs: [] });

  // Authorization: find the record's site via any delegate that has it.
  let siteId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma[RECORD_DELEGATE[logs[0].entityType]] as any).findFirst({
    where: { entityId },
    select: { siteId: true },
  });
  siteId = row?.siteId ?? null;
  if (!ctx.isOwner && (!siteId || !ctx.siteRoles.has(siteId))) {
    throw new ApiError(403, "You do not have permission for this record");
  }

  return NextResponse.json({ logs });
});
