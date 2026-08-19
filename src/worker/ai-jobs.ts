import type PgBoss from "pg-boss";

// Filled in by M9 (AI photo-progress + measurement-book anomaly assist).
export async function registerAiJobs(boss: PgBoss) {
  await boss.createQueue("ai-photo-progress");
  await boss.createQueue("mb-anomaly");
}
