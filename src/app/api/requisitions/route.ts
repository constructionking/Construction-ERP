import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, requireCtx, ApiError } from "@/lib/auth/guard";
import { requisitionSchema } from "@/lib/versioning/schemas";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { formatINRCompact } from "@/lib/format/inr";

export const POST = withApi(async (req: NextRequest) => {
  const data = requisitionSchema.parse(await req.json());
  const ctx = await guard("requisition.create", { siteId: data.siteId });

  if (data.kind === "material") {
    const ids = (data.lines as { materialId: string }[]).map((l) => l.materialId);
    const count = await prisma.material.count({ where: { id: { in: ids } } });
    if (count !== new Set(ids).size) throw new ApiError(400, "Unknown material in lines");
  }

  const requisition = await prisma.requisition.create({
    data: { ...data, status: "submitted", createdById: ctx.userId },
  });

  // Route the notification to the right approver group.
  const site = await prisma.site.findUnique({ where: { id: data.siteId } });
  if (data.kind === "fund") {
    const approvers = await prisma.siteRole.findMany({
      where: { siteId: data.siteId, role: "accounts" },
    });
    await prisma.notification.createMany({
      data: approvers.map((a) => ({
        userId: a.userId,
        title: `Fund request · ${site?.code ?? ""}`,
        body: `${ctx.name} requests ${formatINRCompact(Number(requisition.amountTotal ?? 0))} — ${data.justification.slice(0, 120)}`,
      })),
    });
  } else {
    const owners = await prisma.user.findMany({ where: { isOwner: true, isActive: true } });
    await prisma.notification.createMany({
      data: owners.map((o) => ({
        userId: o.id,
        title: `Material request · ${site?.code ?? ""}`,
        body: `${ctx.name} raised a material requisition — ${data.justification.slice(0, 120)}`,
      })),
    });
  }

  return NextResponse.json({ requisition }, { status: 201 });
});

const listQuery = z.object({
  siteId: z.string().uuid().optional(),
  kind: z.enum(["material", "fund"]).optional(),
});

export const GET = withApi(async (req: NextRequest) => {
  const ctx = await requireCtx();
  const q = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams));

  let siteIds: string[] | undefined;
  let kind = q.kind;

  if (ctx.isOwner) {
    siteIds = q.siteId ? [q.siteId] : undefined;
  } else {
    const roleSites = [...ctx.siteRoles.entries()];
    const engineerSites = roleSites.filter(([, r]) => r === "engineer").map(([s]) => s);
    const accountsSites = roleSites.filter(([, r]) => r === "accounts").map(([s]) => s);

    if (q.siteId) {
      if (!ctx.siteRoles.has(q.siteId)) throw new ApiError(403, "No access to this site");
      siteIds = [q.siteId];
      // Accounts personnel see ONLY fund requests — enforced here, not in UI.
      if (ctx.siteRoles.get(q.siteId) === "accounts") kind = "fund";
    } else if (engineerSites.length > 0) {
      siteIds = engineerSites;
    } else if (accountsSites.length > 0) {
      siteIds = accountsSites;
      kind = "fund";
    } else {
      return NextResponse.json({ requisitions: [] });
    }
  }

  const items = await listRequisitionsWithState({ siteIds, kind });
  return NextResponse.json({ requisitions: items });
});
