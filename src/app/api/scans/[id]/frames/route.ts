import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const bodySchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(40),
  finalize: z.boolean().default(false),
});

export const MIN_FRAMES = 8;

// Attach captured frames (already uploaded as photos, kind=scan_frame) and,
// on finalize, queue the reconstruction job for the Python worker.
export const POST = withApi(async (req: NextRequest, params) => {
  const scanId = z.string().uuid().parse(params.id);
  const body = bodySchema.parse(await req.json());

  const scan = await prisma.stockpileScan.findUnique({
    where: { id: scanId },
    include: { frames: true },
  });
  if (!scan) throw new ApiError(404, "Scan not found");
  await guard("scan.create", { siteId: scan.siteId });
  if (scan.status !== "capturing") {
    throw new ApiError(409, "Frames can only be added while the scan is capturing");
  }

  const photos = await prisma.photo.findMany({
    where: { id: { in: body.photoIds }, siteId: scan.siteId, kind: "scan_frame" },
  });
  if (photos.length !== body.photoIds.length) {
    throw new ApiError(400, "Some photo ids are not scan frames of this site");
  }

  let sequence = scan.frames.length;
  for (const photoId of body.photoIds) {
    await prisma.scanFrame.create({
      data: { scanId, photoId, sequence: sequence++ },
    });
  }

  if (body.finalize) {
    const total = scan.frames.length + body.photoIds.length;
    if (total < MIN_FRAMES) {
      throw new ApiError(400, `At least ${MIN_FRAMES} frames are needed (you have ${total})`);
    }
    await prisma.$transaction([
      prisma.stockpileScan.update({ where: { id: scanId }, data: { status: "queued" } }),
      prisma.scanJob.create({ data: { scanId } }),
    ]);
  }

  return NextResponse.json({ ok: true, frameCount: sequence });
});
