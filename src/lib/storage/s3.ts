import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./provider";

export class S3Storage implements StorageProvider {
  private client: S3Client;

  constructor(
    private bucket: string,
    opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string }
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint || undefined,
      region: opts.region,
      forcePathStyle: !!opts.endpoint,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType })
    );
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const bytes = await res.Body!.transformToByteArray();
      return {
        data: Buffer.from(bytes),
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
