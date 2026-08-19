import type PgBoss from "pg-boss";
import { prisma } from "@/lib/db";
import { runConsumptionAudit, runLabourAudit } from "@/lib/audit/engine";

// Nightly sweep: re-evaluates conditions that drift without new submissions —
// open labour periods accrue cost daily, and consumption variance moves when
// progress arrives after the material entry.
export async function registerAuditJobs(boss: PgBoss) {
  await boss.createQueue("audit-sweep");
  await boss.schedule("audit-sweep", "30 19 * * *", {}, { tz: "UTC" }); // 01:00 IST
  await boss.work("audit-sweep", async () => {
    // Every (activity, mix) pair with recorded consumption
    const pairs = await prisma.consumptionEntry.groupBy({
      by: ["siteId", "activityId", "mixDesignId"],
      where: { isCurrent: true, status: "submitted", mixDesignId: { not: null } },
    });
    for (const pair of pairs) {
      await runConsumptionAudit({
        siteId: pair.siteId,
        activityId: pair.activityId,
        mixDesignId: pair.mixDesignId,
      }).catch((err) => console.error("[audit-sweep] consumption", err));
    }

    // Open period labour: cost per unit grows every day the period stays open
    const openPeriods = await prisma.labourEntry.findMany({
      where: { isCurrent: true, status: "submitted", entryType: "period" },
      select: { entityId: true },
    });
    for (const entry of openPeriods) {
      await runLabourAudit(entry.entityId).catch((err) =>
        console.error("[audit-sweep] labour", err)
      );
    }

    console.log(
      `[audit-sweep] evaluated ${pairs.length} consumption pairs, ${openPeriods.length} labour periods`
    );
  });
}
