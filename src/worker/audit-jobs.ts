import type PgBoss from "pg-boss";

// Filled in by M8 (nightly audit sweep).
export async function registerAuditJobs(boss: PgBoss) {
  await boss.createQueue("audit-sweep");
}
