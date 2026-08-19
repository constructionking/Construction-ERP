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

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
