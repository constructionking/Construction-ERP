import PgBoss from "pg-boss";
import { env } from "@/lib/env";

// Web-side job producer. Queues are created by the worker; sending to a queue
// that is not yet provisioned is tolerated (job is dropped with a log line).

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

async function startBoss(): Promise<PgBoss> {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss:web]", err));
  await boss.start();
  return boss;
}

export async function enqueue(queue: string, data: object): Promise<void> {
  try {
    if (!globalForBoss.boss) globalForBoss.boss = startBoss();
    const boss = await globalForBoss.boss;
    await boss.send(queue, data);
  } catch (err) {
    console.error(`[queue] failed to enqueue ${queue}`, err);
  }
}
