import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type Unit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { getStorage, makeStorageKey } from "@/lib/storage";
import { parseMeasurementBook } from "@/lib/mb-parser/parse";
import { amendRecord } from "@/lib/versioning/amend";
import { dateOnly } from "@/lib/versioning/day-close";

export const GET = withApi(async (_req, params) => {
  const entityId = z.string().uuid().parse(params.entityId);
  const book = await prisma.measurementBook.findFirst({
    where: { entityId, isCurrent: true },
    include: { lines: { orderBy: { srNo: "asc" } } },
  });
  if (!book) throw new ApiError(404, "Measurement book not found");
  await guard("site.view", { siteId: book.siteId });

  const history = await prisma.editLog.findMany({
    where: { entityType: "measurement_book", entityId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ book, history });
});

// Corrected re-upload = amendment: same date, new file, mandatory reason.
export const PUT = withApi(async (req: NextRequest, params) => {
  const entityId = z.string().uuid().parse(params.entityId);
  const form = await req.formData();
  const reason = z.string().trim().min(5).max(1000).parse(form.get("reason"));
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Missing file");

  const current = await prisma.measurementBook.findFirst({
    where: { entityId, isCurrent: true },
  });
  if (!current) throw new ApiError(404, "Measurement book not found");

  const ctx = await guard("mb.upload", { siteId: current.siteId });

  const site = await prisma.site.findUnique({
    where: { id: current.siteId },
    include: { activities: { select: { code: true, unit: true } } },
  });
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseMeasurementBook(buffer, {
    code: site!.code,
    activities: site!.activities,
  });

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Corrected file still has errors", rowErrors: parsed.errors },
      { status: 422 }
    );
  }
  if (parsed.mbDate !== dateOnly(current.mbDate)) {
    throw new ApiError(400, "The corrected file must carry the same date as the original book");
  }

  const key = makeStorageKey({
    siteId: current.siteId,
    kind: "mb",
    fileName: file.name || "mb.xlsx",
  });
  await getStorage().put(
    key,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  const actorRoleLabel = ctx.isOwner ? "owner" : "engineer";
  const result = await amendRecord({
    recordType: "measurement_book",
    entityId,
    ctx,
    actorRoleLabel,
    reason,
    data: {
      sheetNo: parsed.sheetNo!,
      storageKey: key,
      parseStatus: "parsed",
      rowErrors: Prisma.JsonNull,
    },
  });

  await prisma.mbLine.createMany({
    data: parsed.lines.map((l) => ({
      measurementBookId: result.id,
      srNo: l.srNo,
      lineDate: new Date(l.lineDate),
      activityCode: l.activityCode,
      description: l.description,
      location: l.location,
      nos: new Prisma.Decimal(l.nos),
      length: l.length !== null ? new Prisma.Decimal(l.length) : null,
      breadth: l.breadth !== null ? new Prisma.Decimal(l.breadth) : null,
      depth: l.depth !== null ? new Prisma.Decimal(l.depth) : null,
      qty: new Prisma.Decimal(l.qty),
      unit: l.unit as Unit,
      executedBy: l.executedBy,
      remarks: l.remarks,
    })),
  });

  return NextResponse.json({ ok: true, ...result, lineCount: parsed.lines.length });
});
