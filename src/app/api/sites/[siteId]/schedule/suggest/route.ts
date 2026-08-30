import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { runScheduleSuggestion } from "@/lib/schedule/service";

const bodySchema = z
  .object({
    // Project start date: the whole model is computed forward from this day.
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    months: z.array(z.number().int().min(1).max(12)).optional(),
    multipliers: z.record(z.string(), z.number().min(0).max(1)).optional(),
  })
  .optional();

export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  await guard("schedule.suggest", { siteId });
  const raw = await req.text();
  const body = bodySchema.parse(raw ? JSON.parse(raw) : undefined);
  const suggestion = await runScheduleSuggestion(siteId, body as never);
  return NextResponse.json({ suggestion }, { status: 201 });
});
