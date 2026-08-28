// All file access goes through this interface. Database rows store only the
// opaque storage key, so swapping local disk for S3 is a config change.
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function makeStorageKey(parts: {
  siteId: string;
  kind: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${parts.siteId}/${parts.kind}/${stamp}-${rand}-${safe}`;
}
