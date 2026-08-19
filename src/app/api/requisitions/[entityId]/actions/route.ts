import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { formatINRCompact } from "@/lib/format/inr";

const actionSchema = z
  .object({
    action: z.enum(["approved", "partially_approved", "rejected", "queried", "queued"]),
    approvedAmount: z.number().positive().optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    // Accountability: saying no (or asking why) always carries a reason.
    if ((v.action === "rejected" || v.action === "queried") && !v.reason?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `A reason is mandatory when ${v.action === "rejected" ? "rejecting" : "querying"} a request`,
        path: ["reason"],
      });
    }
    if (v.action === "partially_approved" && v.approvedAmount === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "approvedAmount is required for partial approval",
        path: ["approvedAmount"],
      });
    }
  });

export const POST = withApi(async (req: NextRequest, params) => {
  const entityId = z.string().uuid().parse(params.entityId);
  const body = actionSchema.parse(await req.json());

  const requisition = await prisma.requisition.findFirst({
    where: { entityId, isCurrent: true, status: "submitted" },
  });
  if (!requisition) throw new ApiError(404, "Requisition not found");

  // Fund requests are decided by accounts; material requests by the owner
  // (purchase department arrives in Phase 2).
  const ctx = await guard(
    requisition.kind === "fund" ? "requisition.approve.fund" : "requisition.approve.material",
    { siteId: requisition.siteId }
  );

  if (requisition.createdById === ctx.userId && !ctx.isOwner) {
    throw new ApiError(403, "You cannot decide your own requisition");
  }

  if (body.action === "partially_approved" && requisition.kind === "fund") {
    const total = Number(requisition.amountTotal ?? 0);
    if (body.approvedAmount! >= total) {
      throw new ApiError(400, "Partial approval must be less than the requested amount");
    }
  }

  const action = await prisma.approvalAction.create({
    data: {
      requisitionEntityId: entityId,
      action: body.action,
      approvedAmount: body.approvedAmount,
      reason: body.reason?.trim() || null,
      actorId: ctx.userId,
    },
  });

  // Tell the engineer what happened.
  const labels: Record<string, string> = {
    approved: "approved",
    partially_approved: `partially approved (${formatINRCompact(body.approvedAmount ?? 0)})`,
    rejected: "rejected",
    queried: "queried",
    queued: "queued for later",
  };
  await prisma.notification.create({
    data: {
      userId: requisition.createdById,
      title: `Your ${requisition.kind} request was ${labels[body.action]}`,
      body: body.reason?.trim() || "Open the Requests tab for details.",
    },
  });

  return NextResponse.json({ action }, { status: 201 });
});
