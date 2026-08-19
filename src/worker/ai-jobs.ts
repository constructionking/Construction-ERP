import type PgBoss from "pg-boss";
import { aiEnabled } from "@/lib/ai/client";
import { runPhotoProgressEstimate } from "@/lib/ai/photo-progress";
import { runMbAnomalyReview } from "@/lib/ai/mb-anomaly";

interface PhotoProgressJob {
  siteId: string;
  activityId: string;
}

interface MbAnomalyJob {
  mbVersionRowId: string;
}

export async function registerAiJobs(boss: PgBoss) {
  await boss.createQueue("ai-photo-progress");
  await boss.createQueue("mb-anomaly");

  if (!aiEnabled()) {
    console.log("[ai] ANTHROPIC_API_KEY not set — AI jobs disabled (app fully functional without)");
    return;
  }

  await boss.work("ai-photo-progress", { batchSize: 1 }, async ([job]) => {
    const data = job.data as PhotoProgressJob;
    const result = await runPhotoProgressEstimate(data);
    console.log(
      `[ai-photo-progress] activity ${data.activityId}: ${result ? `${result.estimatePct}%` : "skipped"}`
    );
  });

  await boss.work("mb-anomaly", { batchSize: 1 }, async ([job]) => {
    const data = job.data as MbAnomalyJob;
    const count = await runMbAnomalyReview(data.mbVersionRowId);
    console.log(`[mb-anomaly] book ${data.mbVersionRowId}: ${count ?? "skipped"} remark(s)`);
  });
}
