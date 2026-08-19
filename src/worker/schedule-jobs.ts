import type PgBoss from "pg-boss";

// Filled in by M7 (forecast recompute).
export async function registerScheduleJobs(boss: PgBoss) {
  await boss.createQueue("forecast-recompute");
}
