import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { formatINRCompact } from "@/lib/format/inr";
import {
  deriveState,
  ACCOUNTS_FUND_ACTIONS,
  OWNER_FUND_ACTIONS,
} from "@/lib/requisitions";
import { notifyUsers, ownerUserIds, siteRoleUserIds } from "@/lib/notify";

const actionSchema = z
  .object({
    action: z.enum([
      "approved",
      "partially_approved",
      "rejected",
      "queried",
      "queued",
      "owner_approved",
      "owner_rejected",
      "released",
    ]),
    approvedAmount: z.number().positive().optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    // Accountability: saying no (or asking why) always carries a reason.
    if (
      (v.action === "rejected" || v.action === "queried" || v.action === "owner_rejected") &&
      !v.reason?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A reason is mandatory when rejecting or querying a request",
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

const OWNER_ACTIONS = new Set(["owner_approved", "owner_rejected"]);

export const POST = withApi(async (req: NextRequest, params) => {
  const entityId = z.string().uuid().parse(params.entityId);
  const body = actionSchema.parse(await req.json());

  const requisition = await prisma.requisition.findFirst({
    where: { entityId, isCurrent: true, status: "submitted" },
  });
  if (!requisition) throw new ApiError(404, "Requisition not found");

  // Material requests keep the single-step owner decision; the extended
  // chain (owner final approval + release) applies to fund requests only.
  if (requisition.kind === "material" && (OWNER_ACTIONS.has(body.action) || body.action === "released")) {
    throw new ApiError(400, "This action applies to fund requests only");
  }

  // Authorization by who acts at this step.
  const ctx = OWNER_ACTIONS.has(body.action)
    ? await guard("requisition.finalApprove", { siteId: requisition.siteId })
    : await guard(
        requisition.kind === "fund" ? "requisition.approve.fund" : "requisition.approve.material",
        { siteId: requisition.siteId }
      );

  if (requisition.createdById === ctx.userId && !ctx.isOwner) {
    throw new ApiError(403, "You cannot decide your own requisition");
  }

  // State-machine validation: only legal transitions get written.
  const priorActions = await prisma.approvalAction.findMany({
    where: { requisitionEntityId: entityId },
    orderBy: { createdAt: "asc" },
  });
  const state = deriveState(requisition.kind, requisition, priorActions);

  if (requisition.kind === "fund") {
    const allowed = OWNER_ACTIONS.has(body.action)
      ? OWNER_FUND_ACTIONS[state]
      : ACCOUNTS_FUND_ACTIONS[state];
    if (!allowed.includes(body.action)) {
      throw new ApiError(
        409,
        `"${body.action.replace(/_/g, " ")}" is not valid while the request is ${state.replace(/_/g, " ")}`
      );
    }
  } else if (!["pending", "resubmitted", "queued", "queried"].includes(state)) {
    throw new ApiError(409, `This request is already ${state.replace(/_/g, " ")}`);
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

  // ---- Notifications + push, per step of the chain ----
  const site = await prisma.site.findUnique({ where: { id: requisition.siteId } });
  const siteCode = site?.code ?? "";
  const amount = formatINRCompact(
    Number(body.approvedAmount ?? requisition.amountTotal ?? 0)
  );
  const raiser = [requisition.createdById];

  if (requisition.kind === "fund") {
    switch (body.action) {
      case "approved":
      case "partially_approved":
        // → to the OWNER for final approval
        await notifyUsers(await ownerUserIds(), {
          title: `Fund request awaiting your final approval · ${siteCode}`,
          body: `Accounts ${body.action === "partially_approved" ? `partially approved ${amount}` : `approved ${amount}`} — your approval releases it`,
          url: `/dashboard/${requisition.siteId}/approvals`,
        });
        await notifyUsers(raiser, {
          title: `Fund request cleared by accounts (${amount})`,
          body: "Sent to the owner for final approval.",
          url: `/site/${requisition.siteId}/requisitions`,
        });
        break;
      case "owner_approved":
        // → back to ACCOUNTS to actually release the money
        await notifyUsers(await siteRoleUserIds(requisition.siteId, "accounts"), {
          title: `Owner approved — release funds · ${siteCode}`,
          body: `${amount} is cleared for release. Open the queue to release it.`,
          url: "/approvals",
        });
        await notifyUsers(raiser, {
          title: `Owner approved your fund request (${amount})`,
          body: "Accounts will release the funds shortly.",
          url: `/site/${requisition.siteId}/requisitions`,
        });
        break;
      case "owner_rejected":
        await notifyUsers(
          [...raiser, ...(await siteRoleUserIds(requisition.siteId, "accounts"))],
          {
            title: `Owner rejected the fund request (${amount})`,
            body: body.reason?.trim() || "No reason recorded.",
            url: `/site/${requisition.siteId}/requisitions`,
          }
        );
        break;
      case "released":
        await notifyUsers(raiser, {
          title: `Funds released (${amount}) · ${siteCode}`,
          body: "Accounts has released the approved amount.",
          url: `/site/${requisition.siteId}/requisitions`,
        });
        break;
      default:
        await notifyUsers(raiser, {
          title: `Your fund request was ${body.action.replace(/_/g, " ")}`,
          body: body.reason?.trim() || "Open the Requests tab for details.",
          url: `/site/${requisition.siteId}/requisitions`,
        });
    }
  } else {
    await notifyUsers(raiser, {
      title: `Your material request was ${body.action.replace(/_/g, " ")}`,
      body: body.reason?.trim() || "Open the Requests tab for details.",
      url: `/site/${requisition.siteId}/requisitions`,
    });
  }

  return NextResponse.json({ action }, { status: 201 });
});
