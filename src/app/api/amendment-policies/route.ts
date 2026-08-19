import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { getAmendmentPolicies } from "@/lib/versioning/amend";

export const GET = withApi(async () => {
  await guard("amendmentPolicy.set");
  return NextResponse.json({ policies: await getAmendmentPolicies() });
});

const putSchema = z.object({
  recordType: z.enum([
    "progress_entry",
    "measurement_book",
    "material_receipt",
    "consumption_entry",
    "requisition",
    "labour_entry",
  ]),
  allowedWindow: z.enum(["until_day_close", "until_actioned", "same_day", "never"]),
  allowedActor: z.enum(["author", "owner"]),
  enabled: z.boolean(),
});

export const PUT = withApi(async (req: NextRequest) => {
  const ctx = await guard("amendmentPolicy.set");
  const body = putSchema.parse(await req.json());

  const policy = await prisma.amendmentPolicy.upsert({
    where: { recordType: body.recordType },
    create: { ...body, updatedById: ctx.userId },
    update: {
      allowedWindow: body.allowedWindow,
      allowedActor: body.allowedActor,
      enabled: body.enabled,
      updatedById: ctx.userId,
    },
  });

  return NextResponse.json({ ok: true, policy });
});
