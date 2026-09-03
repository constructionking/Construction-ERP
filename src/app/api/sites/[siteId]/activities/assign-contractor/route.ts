import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";

const bodySchema = z.object({
  groupId: z.string().uuid(),
  // null = unassign the main activity (and its items).
  contractorId: z.string().uuid().nullable(),
});

// Assign a whole MAIN ACTIVITY to a contractor: the group and every item
// under it get the contractor (contractorName kept in sync for progress,
// labour and delay-flag consumers). The UI then opens rate entry for the
// items against this contractor's rate card.
export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("activity.manage", { siteId });
  const { groupId, contractorId } = bodySchema.parse(await req.json());

  const group = await prisma.activity.findUnique({ where: { id: groupId } });
  if (!group || group.siteId !== siteId || !group.isGroup) {
    throw new ApiError(400, "Assignment targets a main activity of this site");
  }
  let contractorName: string | null = null;
  if (contractorId) {
    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor || contractor.siteId !== siteId) {
      throw new ApiError(400, "Contractor does not belong to this site");
    }
    contractorName = contractor.name;
  }

  const updated = await prisma.$transaction(async (tx) => {
    // The group row carries only the assignment marker (contractorId) — a
    // main activity stays a pure heading, so no contractorName on it.
    await tx.activity.update({
      where: { id: groupId },
      data: { contractorId },
    });
    const children = await tx.activity.updateMany({
      where: { parentId: groupId },
      data: { contractorId, contractorName },
    });
    return children.count;
  });

  return NextResponse.json({ ok: true, itemsAssigned: updated });
});
