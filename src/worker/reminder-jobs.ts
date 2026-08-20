import type PgBoss from "pg-boss";
import { prisma } from "@/lib/db";
import { businessDateIST } from "@/lib/versioning/day-close";
import { notifyUsers, siteRoleUserIds } from "@/lib/notify";

// Daily 6:00 pm IST (12:30 UTC) nudge: engineers who have not recorded any
// consumption today get a push reminding them before day-close locks entries.
export async function registerReminderJobs(boss: PgBoss) {
  await boss.createQueue("consumption-reminder");
  await boss.schedule("consumption-reminder", "30 12 * * *", {}, { tz: "UTC" });
  await boss.work("consumption-reminder", async () => {
    const today = businessDateIST();
    const sites = await prisma.site.findMany({ where: { status: "active" } });

    let reminded = 0;
    for (const site of sites) {
      const engineers = await siteRoleUserIds(site.id, "engineer");
      if (engineers.length === 0) continue;

      // Skip engineers who already entered consumption today on this site.
      const enteredToday = await prisma.consumptionEntry.findMany({
        where: {
          siteId: site.id,
          isCurrent: true,
          status: "submitted",
          entryDate: new Date(today),
        },
        select: { createdById: true },
        distinct: ["createdById"],
      });
      const doneBy = new Set(enteredToday.map((e) => e.createdById));
      const pending = engineers.filter((id) => !doneBy.has(id));
      if (pending.length === 0) continue;

      await notifyUsers(pending, {
        title: `⏰ Update today's consumption · ${site.code}`,
        body: `No material consumption recorded for ${today} yet. Entries lock at day close (23:59).`,
        url: `/site/${site.id}/inventory`,
      });
      reminded += pending.length;
    }
    console.log(`[consumption-reminder] ${today}: nudged ${reminded} engineer(s)`);
  });
}
