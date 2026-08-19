import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { templateVolumeCum, volumeToQty, type MaterialConversion } from "@/lib/scan/volume";

// Method-agnostic scan intake. Today: photogrammetry (guided photo orbit,
// server reconstruction) and template (shape + dims, instant). A future
// native LiDAR app posts method="lidar" with a precomputed volume and flows
// through the exact same result/decision/variance pipeline.

const createSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("photogrammetry"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    markerSizeMm: z.number().int().min(50).max(2000),
  }),
  z.object({
    method: z.literal("template"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    shape: z.enum(["cone", "rect_stack", "windrow"]),
    dims: z.object({
      length: z.number().positive().max(500),
      width: z.number().positive().max(500).optional(),
      height: z.number().positive().max(50),
    }),
  }),
  z.object({
    method: z.literal("lidar"),
    siteId: z.string().uuid(),
    materialId: z.string().uuid(),
    volumeCum: z.number().positive().max(1_000_000),
    confidence: z.number().min(0).max(1).optional(),
    meshStorageKey: z.string().optional(),
  }),
]);

export const POST = withApi(async (req: NextRequest) => {
  const body = createSchema.parse(await req.json());
  const ctx = await guard("scan.create", { siteId: body.siteId });

  const material = await prisma.material.findUnique({ where: { id: body.materialId } });
  if (!material) throw new ApiError(400, "Unknown material");
  const conversion: MaterialConversion = {
    unit: material.unit,
    densityKgPerCum: material.densityKgPerCum !== null ? Number(material.densityKgPerCum) : null,
    unitsPerCum: material.unitsPerCum !== null ? Number(material.unitsPerCum) : null,
  };

  if (body.method === "photogrammetry") {
    const scan = await prisma.stockpileScan.create({
      data: {
        siteId: body.siteId,
        materialId: body.materialId,
        method: "photogrammetry",
        status: "capturing",
        markerSizeMm: body.markerSizeMm,
        createdById: ctx.userId,
      },
    });
    return NextResponse.json({ scan }, { status: 201 });
  }

  // template + lidar produce a result immediately
  const volumeCum =
    body.method === "template" ? templateVolumeCum(body.shape, body.dims) : body.volumeCum;
  if (volumeCum <= 0) throw new ApiError(400, "Dimensions produce no volume");
  const computedQty = volumeToQty(volumeCum, conversion);
  if (computedQty === null) {
    throw new ApiError(
      400,
      `${material.name} lacks a volume conversion factor (density or units per CUM) — ask the owner to set it in the material master`
    );
  }

  const scan = await prisma.stockpileScan.create({
    data: {
      siteId: body.siteId,
      materialId: body.materialId,
      method: body.method,
      status: "computed",
      createdById: ctx.userId,
      result: {
        create: {
          computedVolumeCum: volumeCum,
          computedQty,
          qtyUnit: material.unit,
          confidence: body.method === "lidar" ? (body.confidence ?? 0.9) : 0.5,
          methodUsed: body.method,
          markerDetected: false,
          registeredFrames: 0,
          meshStorageKey: body.method === "lidar" ? (body.meshStorageKey ?? null) : null,
        },
      },
    },
    include: { result: true },
  });
  return NextResponse.json({ scan }, { status: 201 });
});

const listQuery = z.object({ siteId: z.string().uuid() });

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.view", { siteId: q.siteId });
  const scans = await prisma.stockpileScan.findMany({
    where: { siteId: q.siteId },
    orderBy: { createdAt: "desc" },
    include: { result: true, decision: true, job: true },
    take: 50,
  });
  return NextResponse.json({ scans });
});
