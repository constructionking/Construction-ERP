import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireCtx, ApiError } from "@/lib/auth/guard";
import { getStorage } from "@/lib/storage";

// Auth-gated file serving. Storage keys are prefixed with the owning site id,
// so access control falls out of the key itself.
export const GET = withApi(async (_req, params) => {
  const ctx = await requireCtx();
  const key = Array.isArray(params.key) ? (params.key as string[]).join("/") : String(params.key);

  const siteId = key.split("/")[0];
  if (!ctx.isOwner && !ctx.siteRoles.has(siteId)) {
    throw new ApiError(403, "You do not have access to this file");
  }

  const file = await getStorage().get(key);
  if (!file) throw new ApiError(404, "File not found");

  // Serve only known-safe types inline; anything else downloads as an opaque
  // attachment so uploaded content can never execute in the app's origin.
  const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
  const isInline = INLINE_TYPES.has(file.contentType);
  const isXlsx =
    file.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const contentType = isInline || isXlsx ? file.contentType : "application/octet-stream";
  const fileName = key.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "file";

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${isInline ? "inline" : "attachment"}; filename="${fileName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
