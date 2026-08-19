import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";
import { lockBaseline, recomputeForecasts } from "@/lib/schedule/service";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z.object({
  activities: z
    .array(
      z.object({
        activityId: z.string().uuid(),
        plannedStart: dateStr,
        plannedEnd: dateStr,
      })
    )
    .min(1),
  note: z.string().trim().max(500).optional(),
});

// Owner reviews the suggested dates (accepting or adjusting each) and LOCKS.
// Locking is an insert of an immutable baseline version; after this the
// planned dates cannot be modified — only a new owner-locked version replaces.
export const POST = withApi(async (req: NextRequest, params) => {
  const siteId = params.siteId;
  const ctx = await guard("baseline.lock", { siteId });
  const body = bodySchema.parse(await req.json());
  const baseline = await lockBaseline(siteId, ctx.userId, body.activities, body.note);
  await recomputeForecasts(siteId).catch((err) => console.error("forecast recompute", err));
  return NextResponse.json({ baseline }, { status: 201 });
});
