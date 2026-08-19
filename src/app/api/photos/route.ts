import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { getStorage, makeStorageKey } from "@/lib/storage";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

const metaSchema = z.object({
  siteId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  kind: z.enum(["progress", "receipt", "scan_frame"]),
  takenAt: z.string().datetime().optional(),
  geoLat: z.coerce.number().min(-90).max(90).optional(),
  geoLng: z.coerce.number().min(-180).max(180).optional(),
  geoAccuracy: z.coerce.number().nonnegative().optional(),
});

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Missing file");
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, "Photo exceeds 15 MB");
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ApiError(400, `Unsupported image type: ${file.type || "unknown"}`);
  }

  const meta = metaSchema.parse({
    siteId: form.get("siteId"),
    activityId: form.get("activityId") ?? undefined,
    kind: form.get("kind"),
    takenAt: form.get("takenAt") ?? undefined,
    geoLat: form.get("geoLat") ?? undefined,
    geoLng: form.get("geoLng") ?? undefined,
    geoAccuracy: form.get("geoAccuracy") ?? undefined,
  });

  const ctx = await guard("photo.upload", { siteId: meta.siteId });

  if (meta.activityId) {
    const activity = await prisma.activity.findUnique({ where: { id: meta.activityId } });
    if (!activity || activity.siteId !== meta.siteId) {
      throw new ApiError(400, "Activity does not belong to this site");
    }
  }

  const key = makeStorageKey({
    siteId: meta.siteId,
    kind: meta.kind,
    fileName: file.name || "photo.jpg",
  });
  await getStorage().put(key, Buffer.from(await file.arrayBuffer()), file.type);

  const photo = await prisma.photo.create({
    data: {
      siteId: meta.siteId,
      activityId: meta.activityId,
      storageKey: key,
      originalName: file.name || null,
      takenAt: meta.takenAt ? new Date(meta.takenAt) : new Date(),
      geoLat: meta.geoLat,
      geoLng: meta.geoLng,
      geoAccuracy: meta.geoAccuracy,
      uploadedById: ctx.userId,
      kind: meta.kind,
    },
  });

  // Progress photos linked to an activity get an async AI second opinion.
  if (meta.kind === "progress" && meta.activityId) {
    const { enqueue } = await import("@/lib/queue");
    await enqueue("ai-photo-progress", { siteId: meta.siteId, activityId: meta.activityId });
  }

  return NextResponse.json({ photo: { id: photo.id, storageKey: key } }, { status: 201 });
});

const listQuery = z.object({
  siteId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  kind: z.enum(["progress", "receipt", "scan_frame"]).optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.view", { siteId: q.siteId });
  const photos = await prisma.photo.findMany({
    where: { siteId: q.siteId, activityId: q.activityId, kind: q.kind },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ photos });
});
