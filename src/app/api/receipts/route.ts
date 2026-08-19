import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { materialReceiptSchema } from "@/lib/versioning/schemas";
import { runReceiptAudits } from "@/lib/audit/engine";

export const POST = withApi(async (req: NextRequest) => {
  const data = materialReceiptSchema.parse(await req.json());
  const ctx = await guard("receipt.create", { siteId: data.siteId });

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new ApiError(400, "Unknown material");
  if (material.unit !== data.unit) {
    throw new ApiError(400, `${material.name} is tracked in ${material.unit}`);
  }

  const receipt = await prisma.materialReceipt.create({
    data: { ...data, status: "submitted", createdById: ctx.userId },
  });

  await runReceiptAudits(receipt.id).catch((err) =>
    console.error("receipt audit failed", err)
  );

  return NextResponse.json({ receipt }, { status: 201 });
});

const listQuery = z.object({
  siteId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await guard("site.view", { siteId: q.siteId });
  const receipts = await prisma.materialReceipt.findMany({
    where: { siteId: q.siteId, materialId: q.materialId, isCurrent: true, status: "submitted" },
    orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ receipts });
});
