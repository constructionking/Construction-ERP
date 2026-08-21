/**
 * Create the FIRST owner account on a fresh production database.
 *
 * Users are normally created by an owner from inside the app — so an empty DB
 * has no way in. This one-off script solves that chicken-and-egg. It:
 *   - refuses to run if ANY owner already exists (so it can't be used to mint
 *     extra owners later),
 *   - enforces the same password policy as the rest of the app
 *     (src/lib/auth/password.ts), and
 *   - hashes with bcrypt cost 12 (src/lib/auth/password.ts BCRYPT_COST).
 *
 * Usage (interactive):
 *   docker compose -f docker-compose.prod.yml run --rm worker \
 *     pnpm tsx scripts/bootstrap-owner.ts
 *
 * Or non-interactive (e.g. automation) via env vars:
 *   OWNER_NAME="..." OWNER_EMAIL="..." OWNER_PASSWORD="..." \
 *     pnpm tsx scripts/bootstrap-owner.ts
 */
import * as readline from "node:readline";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { validatePassword, BCRYPT_COST } from "@/lib/auth/password";

function ask(question: string, opts: { muted?: boolean } = {}): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (opts.muted) {
      // Suppress echo while typing a password.
      const asAny = rl as unknown as { _writeToOutput?: (s: string) => void };
      const original = asAny._writeToOutput?.bind(rl);
      asAny._writeToOutput = (str: string) => {
        if (str.includes(question)) original?.(str);
        // otherwise swallow the echoed keystrokes
      };
      rl.question(question, (answer) => {
        process.stdout.write("\n");
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const existingOwner = await prisma.user.findFirst({ where: { isOwner: true } });
  if (existingOwner) {
    console.error(
      `Refusing to run: an owner already exists (${existingOwner.email}). ` +
        `Create further users from inside the app.`,
    );
    process.exit(1);
  }

  const name = (process.env.OWNER_NAME || (await ask("Owner full name: "))).trim();
  const emailRaw = process.env.OWNER_EMAIL || (await ask("Owner email: "));
  const email = emailRaw.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD || (await ask("Owner password: ", { muted: true }));

  if (!name) {
    console.error("Name is required.");
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("That does not look like a valid email address.");
    process.exit(1);
  }
  const pwError = validatePassword(password);
  if (pwError) {
    console.error(`Password rejected: ${pwError}`);
    process.exit(1);
  }

  // Guard the unique-email constraint with a friendly message.
  const clash = await prisma.user.findUnique({ where: { email } });
  if (clash) {
    console.error(`A user with email ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const owner = await prisma.user.create({
    data: { name, email, passwordHash, isOwner: true },
  });

  console.log(`\n✅ Owner created: ${owner.name} <${owner.email}>`);
  console.log("Sign in at your app URL, then add sites, engineers and accounts users.");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
