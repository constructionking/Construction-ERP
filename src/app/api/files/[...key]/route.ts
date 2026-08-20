import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireCtx, ApiError } from "@/lib/auth/guard";
import { isAllowed } from "@/lib/auth/policies";
import { getStorage } from "@/lib/storage";

// Auth-gated file serving. Storage keys are `${siteId}/${kind}/...`, so both
// the owning site AND the operational nature fall out of the key itself.
export const GET = withApi(async (_req, params) => {
  const ctx = await requireCtx();
  const key = Array.isArray(params.key) ? (params.key as string[]).join("/") : String(params.key);

  const [siteId] = key.split("/");
  // All stored files (progress/receipt/scan/mb) are operational artifacts:
  // require site.ops.view (engineer or owner). Accounts — limited to fund
  // requisitions, which carry no files — is denied, matching the RBAC
  // boundary the rest of the operational routes enforce.
  if (!isAllowed(ctx, "site.ops.view", siteId)) {
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
