/**
 * Migrate on-server uploads to S3-compatible object storage (Cloudflare R2, AWS
 * S3, MinIO, …). Run this ONCE when you decide to move off local-disk storage.
 *
 * It copies every blob from the local storage directory to the bucket, reusing
 * the exact same storage KEYS the database already references — so once the copy
 * is verified you only flip STORAGE_DRIVER=local -> s3 and restart; no data rows
 * change.
 *
 * Steps (also in DEPLOY.md):
 *   1. Create an R2 bucket + API token; put the creds in .env:
 *        S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
 *        S3_BUCKET=construction-erp   S3_ACCESS_KEY_ID=...   S3_SECRET_ACCESS_KEY=...
 *      (Leave STORAGE_DRIVER=local for now.)
 *   2. Dry run:   docker compose -f docker-compose.prod.yml run --rm worker \
 *                   pnpm tsx scripts/migrate-storage-to-r2.ts --dry-run
 *   3. Real run:  ...same without --dry-run
 *   4. Set STORAGE_DRIVER=s3 in .env, then: docker compose ... up -d web worker
 *   5. Verify a photo loads, THEN keep the local files as a backup for a while.
 *
 * ⚠️  DATA-LOSS NOTE: do not delete the local storage directory until you have
 *     confirmed every file serves correctly from the bucket.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { S3Storage } from "@/lib/storage/s3";
import { env } from "@/lib/env";

const DRY_RUN = process.argv.includes("--dry-run");
const SRC = env.STORAGE_DIR;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main() {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    console.error("Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env first.");
    process.exit(1);
  }
  const dest = new S3Storage(env.S3_BUCKET, {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });

  const base = path.resolve(SRC);
  let copied = 0;
  let skipped = 0;
  for await (const file of walk(base)) {
    // Sidecar ".meta" files hold content types; they are not objects themselves.
    if (file.endsWith(".meta")) continue;
    const key = path.relative(base, file).split(path.sep).join("/");
    const contentType = await fs
      .readFile(file + ".meta", "utf8")
      .catch(() => "application/octet-stream");

    if (DRY_RUN) {
      console.log(`would copy  ${key}  (${contentType})`);
      skipped++;
      continue;
    }
    const data = await fs.readFile(file);
    await dest.put(key, data, contentType);
    copied++;
    if (copied % 50 === 0) console.log(`  ...${copied} copied`);
  }

  console.log(
    DRY_RUN
      ? `Dry run: ${skipped} files would be copied. Re-run without --dry-run to copy.`
      : `✅ Copied ${copied} files to bucket '${env.S3_BUCKET}'. ` +
          `Now set STORAGE_DRIVER=s3 in .env and restart web + worker.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
