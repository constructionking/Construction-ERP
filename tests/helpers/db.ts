import { PrismaClient } from "@prisma/client";

export const testDb = new PrismaClient();

/** Truncate all app tables between test files (order-safe via CASCADE). */
export async function resetDb() {
  const tables: Array<{ tablename: string }> = await testDb.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  // TRUNCATE fires no row-level triggers, so the immutability triggers do not
  // block test cleanup (row-wise DELETE would be rejected, by design).
  await testDb.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function makeUser(opts: {
  email: string;
  isOwner?: boolean;
  name?: string;
}) {
  return testDb.user.create({
    data: {
      email: opts.email,
      name: opts.name ?? opts.email.split("@")[0],
      passwordHash: "x",
      isOwner: opts.isOwner ?? false,
    },
  });
}

export async function makeSite(code = "TST") {
  return testDb.site.create({
    data: { name: `Test Site ${code}`, code },
  });
}
