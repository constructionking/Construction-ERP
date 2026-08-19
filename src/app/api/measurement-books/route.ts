import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type Unit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { getStorage, makeStorageKey } from "@/lib/storage";
import { parseMeasurementBook } from "@/lib/mb-parser/parse";

const MAX_MB_BYTES = 10 * 1024 * 1024;

async function loadAndParse(siteId: string, file: File) {
  if (file.size > MAX_MB_BYTES) throw new ApiError(413, "File exceeds 10 MB");
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { activities: { select: { code: true, unit: true } } },
  });
  if (!site) throw new ApiError(404, "Site not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseMeasurementBook(buffer, {
    code: site.code,
    activities: site.activities,
  });
  return { site, buffer, parsed };
}

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const siteId = z.string().uuid().parse(form.get("siteId"));
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Missing file");

  const ctx = await guard("mb.upload", { siteId });
  const { buffer, parsed } = await loadAndParse(siteId, file);

  if (!parsed.ok) {
    // Nothing is stored for a failed parse — fix the file and upload again.
    return NextResponse.json(
      { error: "Measurement book has errors — fix and re-upload", rowErrors: parsed.errors },
      { status: 422 }
    );
  }

  const mbDate = new Date(parsed.mbDate!);
  const existing = await prisma.measurementBook.findFirst({
    where: { siteId, mbDate, isCurrent: true },
  });
  if (existing) {
    throw new ApiError(
      409,
      "A measurement book for this date already exists — use the corrected re-upload option (a reason is required)"
    );
  }

  const key = makeStorageKey({ siteId, kind: "mb", fileName: file.name || "mb.xlsx" });
  await getStorage().put(
    key,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  const book = await prisma.$transaction(async (tx) => {
    const created = await tx.measurementBook.create({
      data: {
        siteId,
        mbDate,
        sheetNo: parsed.sheetNo!,
        storageKey: key,
        parseStatus: "parsed",
        status: "submitted",
        createdById: ctx.userId,
      },
    });
    await tx.mbLine.createMany({
      data: parsed.lines.map((l) => ({
        measurementBookId: created.id,
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
    return created;
  });

  const { enqueue } = await import("@/lib/queue");
  await enqueue("mb-anomaly", { mbVersionRowId: book.id });

  return NextResponse.json(
    { book: { id: book.id, entityId: book.entityId, lineCount: parsed.lines.length } },
    { status: 201 }
  );
});

const listQuery = z.object({
  siteId: z.string().uuid(),
});

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.view", { siteId: q.siteId });
  const books = await prisma.measurementBook.findMany({
    where: { siteId: q.siteId, isCurrent: true },
    orderBy: { mbDate: "desc" },
    include: { _count: { select: { lines: true } } },
    take: 60,
  });
  return NextResponse.json({ books });
});
