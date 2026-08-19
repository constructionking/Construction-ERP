import type PgBoss from "pg-boss";
import { prisma } from "@/lib/db";
import { recomputeForecasts } from "@/lib/schedule/service";

// Nightly forecast recompute for every active site (progress submissions also
// trigger an immediate recompute; this catches drift on idle days, where a
// silent site slips further behind without any new entries).
export async function registerScheduleJobs(boss: PgBoss) {
  await boss.createQueue("forecast-recompute");
  await boss.schedule("forecast-recompute", "0 19 * * *", {}, { tz: "UTC" }); // 00:30 IST
  await boss.work("forecast-recompute", async () => {
    const sites = await prisma.site.findMany({ where: { status: "active" } });
    for (const site of sites) {
      const result = await recomputeForecasts(site.id).catch((err) => {
        console.error(`forecast recompute failed for ${site.code}`, err);
        return { updated: 0 };
      });
      console.log(`[forecast] ${site.code}: ${result.updated} activities updated`);
    }
  });
}
