import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard, ApiError } from "@/lib/auth/guard";
import { listRequisitionsWithState } from "@/lib/requisitions";
import { canonicalMaterialName, inferCategory, normalizeUnit } from "@/lib/inventory/demand";
import { unitEnum } from "@/lib/versioning/schemas";

// Receiving against an OWNER-APPROVED demand line: resolve the engineer's
// typed item to a material-master row (find by name, else create it under
// the inferred category in the engineer's unit) so the receipt lands on the
// owner's inventory. Returns the material + what is still due on the line.
const bodySchema = z.object({
  siteId: z.string().uuid(),
  requisitionEntityId: z.string().uuid(),
  lineIndex: z.number().int().min(0).max(200),
  // When the typed unit can't be recognised the UI asks the engineer to pick one.
  unit: unitEnum.optional(),
});

export const POST = withApi(async (req: NextRequest) => {
  const body = bodySchema.parse(await req.json());
  const ctx = await guard("receipt.create", { siteId: body.siteId });

  const list = await listRequisitionsWithState({ siteIds: [body.siteId], kind: "material" });
  const found = list.find((r) => r.requisition.entityId === body.requisitionEntityId);
  if (!found) throw new ApiError(404, "Material request not found for this site");
  if (found.state !== "approved" && found.state !== "partially_approved") {
    throw new ApiError(409, "Only owner-approved requests can be received against");
  }
  const lines = found.requisition.lines as Array<{
    item?: string;
    type?: "material" | "tool" | "other";
    qty: number;
    unit: string;
    materialId?: string;
  }>;
  const line = lines[body.lineIndex];
  if (!line) throw new ApiError(400, "No such line on the request");

  let material = line.materialId
    ? await prisma.material.findUnique({ where: { id: line.materialId } })
    : null;
  let created = false;
  if (!material) {
    const name = canonicalMaterialName(line.item ?? "");
    if (!name) throw new ApiError(400, "The request line has no item name");
    const unit = body.unit ?? normalizeUnit(line.unit);
    if (!unit) {
      return NextResponse.json({ needsUnit: true, item: name, typedUnit: line.unit });
    }
    material = await prisma.material.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (!material) {
      material = await prisma.material.create({
        data: {
          name,
          unit,
          category: inferCategory(name, line.type),
          fromDemand: true,
        },
      });
      created = true;
    }
  }

  const received = await prisma.materialReceipt.aggregate({
    where: {
      requisitionEntityId: body.requisitionEntityId,
      materialId: material.id,
      isCurrent: true,
      status: "submitted",
    },
    _sum: { qty: true },
  });
  const alreadyReceived = Number(received._sum.qty ?? 0);

  return NextResponse.json({
    material: { id: material.id, name: material.name, unit: material.unit, category: material.category },
    created,
    createdBy: ctx.userId,
    line: { item: line.item ?? material.name, qty: line.qty, unit: line.unit },
    alreadyReceived,
    remaining: Math.max(0, line.qty - alreadyReceived),
  });
});
