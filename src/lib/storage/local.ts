import { promises as fs } from "fs";
import path from "path";
import type { StorageProvider } from "./provider";

// Content types are persisted alongside the blob in a sidecar file so the
// auth-gated file route can serve the right header without a database lookup.
export class LocalDiskStorage implements StorageProvider {
  constructor(private baseDir: string) {}

  private resolve(key: string): string {
    const p = path.resolve(this.baseDir, key);
    const base = path.resolve(this.baseDir);
    if (!p.startsWith(base + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return p;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
    await fs.writeFile(p + ".meta", contentType, "utf8");
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const p = this.resolve(key);
      const data = await fs.readFile(p);
      const contentType = await fs
        .readFile(p + ".meta", "utf8")
        .catch(() => "application/octet-stream");
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.resolve(key);
    await fs.rm(p, { force: true });
    await fs.rm(p + ".meta", { force: true });
  }
}
