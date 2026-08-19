import PgBoss from "pg-boss";
import { env } from "@/lib/env";
import { businessDateIST, closeBusinessDay } from "@/lib/versioning/day-close";
import { registerAiJobs } from "./ai-jobs";
import { registerScheduleJobs } from "./schedule-jobs";
import { registerAuditJobs } from "./audit-jobs";

// Node-side background jobs (Postgres-backed queue — no Redis).
// The Python photogrammetry worker is separate: it polls scan_jobs directly.

async function main() {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  // 23:59 IST = 18:29 UTC — close every active site's business day.
  await boss.createQueue("day-close");
  await boss.schedule("day-close", "29 18 * * *", {}, { tz: "UTC" });
  await boss.work("day-close", async () => {
    const date = businessDateIST();
    console.log(`[day-close] closing business day ${date}`);
    await closeBusinessDay(date);
  });

  await registerScheduleJobs(boss);
  await registerAuditJobs(boss);
  await registerAiJobs(boss);

  console.log("Worker started: day-close, schedule, audit, AI queues active");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
