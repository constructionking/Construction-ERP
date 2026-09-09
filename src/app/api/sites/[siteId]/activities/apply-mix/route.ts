import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const bodySchema = z
  .object({
    // null clears the mix.
    mixId: z.string().uuid().nullable(),
    // Exactly one target: a single work item, or every item assigned to a contractor.
    activityId: z.string().uuid().optional(),
    contractorId: z.string().uuid().optional(),
  })
  .refine((b) => (b.activityId ? !b.contractorId : !!b.contractorId), {
    message: "Give exactly one of activityId or contractorId",
  });

// Set which mix a sub-activity is built with. The engineer's consumption form
// pre-selects it; the audit keeps keying on the mix actually booked per entry.
export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const { mixId, activityId, contractorId } = bodySchema.parse(await req.json());

  if (mixId) {
    const mix = await prisma.mixDesign.findUnique({ where: { id: mixId } });
    if (!mix) throw new ApiError(404, "Mix design not found");
  }

  if (activityId) {
    const activity = await prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity || activity.siteId !== siteId || activity.isGroup) {
      throw new ApiError(400, "Mixes attach to work items of this site, not main-activity headings");
    }
    await prisma.activity.update({ where: { id: activityId }, data: { defaultMixId: mixId } });
    return NextResponse.json({ ok: true, itemsUpdated: 1 });
  }

  const contractor = await prisma.contractor.findUnique({ where: { id: contractorId! } });
  if (!contractor || contractor.siteId !== siteId) {
    throw new ApiError(400, "Contractor does not belong to this site");
  }
  const updated = await prisma.activity.updateMany({
    where: { siteId, contractorId: contractorId!, isGroup: false },
    data: { defaultMixId: mixId },
  });
  return NextResponse.json({ ok: true, itemsUpdated: updated.count });
});
