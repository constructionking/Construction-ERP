import { env } from "@/lib/env";
import type { StorageProvider } from "./provider";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!instance) {
    if (env.STORAGE_DRIVER === "s3") {
      instance = new S3Storage(env.S3_BUCKET, {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      });
    } else {
      instance = new LocalDiskStorage(env.STORAGE_DIR);
    }
  }
  return instance;
}

export { makeStorageKey } from "./provider";
