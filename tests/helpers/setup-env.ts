// Load .env for tests (Prisma CLI loads it, the client library does not).
import { readFileSync } from "fs";
import path from "path";

try {
  const raw = readFileSync(path.resolve(__dirname, "../../.env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
} catch {
  // .env optional if env vars are set externally
}

// Tests truncate tables between files — never point them at the dev/demo DB.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
