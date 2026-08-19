import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// India Standard Time has no DST, so a fixed minute offset is exact.
const IST_OFFSET_MS = env.DAY_CLOSE_TZ_OFFSET_MINUTES * 60 * 1000;

/** yyyy-mm-dd of the IST business day containing the given instant. */
export function businessDateIST(instant: Date = new Date()): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** For @db.Date values Prisma returns UTC-midnight Dates; format safely. */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A business day counts as closed when it is in the past (even if the nightly
 * job missed it) or when an explicit day-close row exists (manual early close
 * by the owner, or the nightly job).
 */
export async function isDayClosed(siteId: string, businessDate: string): Promise<boolean> {
  if (businessDate < businessDateIST()) return true;
  const row = await prisma.dayClose.findUnique({
    where: { siteId_businessDate: { siteId, businessDate: new Date(businessDate) } },
  });
  return row !== null;
}

/** Nightly job (and owner manual close): record the close for every active site. */
export async function closeBusinessDay(businessDate: string, closedById?: string) {
  const sites = await prisma.site.findMany({ where: { status: "active" }, select: { id: true } });
  for (const site of sites) {
    await prisma.dayClose
      .create({
        data: { siteId: site.id, businessDate: new Date(businessDate), closedById },
      })
      .catch(() => {
        // unique(siteId, businessDate) — already closed is fine
      });
  }
}
