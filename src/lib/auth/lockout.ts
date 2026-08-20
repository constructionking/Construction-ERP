import { prisma } from "@/lib/db";

// Durable brute-force protection. Two independent brakes:
//  - per ACCOUNT: 5 consecutive failures (since the last success) locks the
//    account with exponential backoff: 1 → 2 → 4 → … capped at 30 minutes.
//  - per IP: 30 failures in 15 minutes locks that IP for 15 minutes
//    (stops one machine from spraying many accounts).
// Backed by the login_attempts table — restarts and multiple instances
// cannot reset it, unlike an in-memory counter.

export const ACCOUNT_FAILURE_THRESHOLD = 5;
export const IP_FAILURE_THRESHOLD = 30;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_LOCK_MS = 15 * 60 * 1000;
export const MAX_BACKOFF_MS = 30 * 60 * 1000;

/** Pure: lock duration after `failures` consecutive failures. */
export function backoffMs(failures: number): number {
  if (failures < ACCOUNT_FAILURE_THRESHOLD) return 0;
  const exponent = failures - ACCOUNT_FAILURE_THRESHOLD; // 5th failure → 1 min
  return Math.min(60_000 * 2 ** exponent, MAX_BACKOFF_MS);
}

/** Pure: given the recent attempt history, is this identifier locked now? */
export function evaluateAccountLock(
  attempts: Array<{ success: boolean; createdAt: Date }>,
  now: Date
): { locked: boolean; retryAfterSeconds: number } {
  // Consecutive failures since the most recent success.
  const sorted = [...attempts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let failures = 0;
  let lastFailureAt: Date | null = null;
  for (const attempt of sorted) {
    if (attempt.success) break;
    failures += 1;
    if (!lastFailureAt) lastFailureAt = attempt.createdAt;
  }
  const lockMs = backoffMs(failures);
  if (lockMs === 0 || !lastFailureAt) return { locked: false, retryAfterSeconds: 0 };
  const unlockAt = lastFailureAt.getTime() + lockMs;
  if (now.getTime() >= unlockAt) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil((unlockAt - now.getTime()) / 1000) };
}

export async function checkLockout(
  identifier: string,
  ip: string
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000);

  const [accountAttempts, ipFailures] = await Promise.all([
    prisma.loginAttempt.findMany({
      where: { identifier, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { success: true, createdAt: true },
    }),
    prisma.loginAttempt.count({
      where: { ip, success: false, createdAt: { gte: new Date(now.getTime() - IP_WINDOW_MS) } },
    }),
  ]);

  if (ipFailures >= IP_FAILURE_THRESHOLD) {
    return { locked: true, retryAfterSeconds: Math.ceil(IP_LOCK_MS / 1000) };
  }
  return evaluateAccountLock(accountAttempts, now);
}

export async function recordAttempt(
  identifier: string,
  ip: string,
  success: boolean
): Promise<void> {
  await prisma.loginAttempt.create({ data: { identifier, ip, success } });
  // Opportunistic cleanup so the table never grows unbounded.
  if (Math.random() < 0.02) {
    await prisma.loginAttempt
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } })
      .catch(() => {});
  }
}

export type LoginGateResult =
  | { status: "locked"; retryAfterSeconds: number }
  | { status: "done"; ok: boolean };

/**
 * Atomic login gate — the ONLY correct path for the login route.
 *
 * A Postgres per-identifier advisory lock (`pg_advisory_xact_lock`) serializes
 * all concurrent attempts for the SAME account, closing the parallel
 * brute-force window where N simultaneous requests each read a stale
 * "under threshold" count before any of them records a failure. Attempts for
 * different accounts take different lock keys and never contend. The password
 * verification runs inside the lock so the recorded count is always consistent
 * with the decision.
 */
export async function withLoginGate(
  identifier: string,
  ip: string,
  verify: () => Promise<boolean>
): Promise<LoginGateResult> {
  return prisma.$transaction(
    async (tx) => {
      // Serialize on this account; different accounts don't block each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`;

      const now = new Date();
      const since = new Date(now.getTime() - 24 * 3600 * 1000);
      const [accountAttempts, ipFailures] = await Promise.all([
        tx.loginAttempt.findMany({
          where: { identifier, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { success: true, createdAt: true },
        }),
        tx.loginAttempt.count({
          where: {
            ip,
            success: false,
            createdAt: { gte: new Date(now.getTime() - IP_WINDOW_MS) },
          },
        }),
      ]);

      if (ipFailures >= IP_FAILURE_THRESHOLD) {
        return { status: "locked", retryAfterSeconds: Math.ceil(IP_LOCK_MS / 1000) };
      }
      const lock = evaluateAccountLock(accountAttempts, now);
      if (lock.locked) {
        return { status: "locked", retryAfterSeconds: lock.retryAfterSeconds };
      }

      const ok = await verify();
      await tx.loginAttempt.create({ data: { identifier, ip, success: ok } });
      return { status: "done", ok };
    },
    { timeout: 15000 }
  );
}
