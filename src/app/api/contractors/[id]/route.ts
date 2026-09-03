import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  active: z.boolean().optional(),
});

export const PATCH = withApi(async (req: NextRequest, params) => {
  const contractor = await prisma.contractor.findUnique({ where: { id: params.id } });
  if (!contractor) throw new ApiError(404, "Contractor not found");
  await guard("activity.manage", { siteId: contractor.siteId });
  const data = patchSchema.parse(await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.contractor.update({ where: { id: params.id }, data });
    // Keep the legacy display string in sync everywhere it is assigned.
    if (data.name && data.name !== contractor.name) {
      await tx.activity.updateMany({
        where: { contractorId: params.id },
        data: { contractorName: data.name },
      });
    }
    return c;
  });
  return NextResponse.json({ contractor: updated });
});

export const DELETE = withApi(async (_req, params) => {
  const contractor = await prisma.contractor.findUnique({ where: { id: params.id } });
  if (!contractor) throw new ApiError(404, "Contractor not found");
  await guard("activity.manage", { siteId: contractor.siteId });
  const assigned = await prisma.activity.count({ where: { contractorId: params.id } });
  if (assigned > 0) {
    throw new ApiError(409, `${assigned} activities are assigned to this contractor — unassign first`);
  }
  await prisma.contractorRate.deleteMany({ where: { contractorId: params.id } });
  await prisma.contractor.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
