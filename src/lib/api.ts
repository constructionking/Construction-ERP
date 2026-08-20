import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@/lib/auth/guard";

// Params values are strings for normal segments, string[] for catch-alls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteParams = Record<string, any>;

type Handler = (req: NextRequest, params: RouteParams) => Promise<NextResponse | Response>;

/**
 * Route-handler wrapper: uniform error mapping + same-origin check on
 * mutating requests (CSRF defence alongside the SameSite cookie).
 */
export function withApi(handler: Handler) {
  return async (
    req: NextRequest,
    context: { params: Promise<RouteParams> }
  ): Promise<Response> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        const host = req.headers.get("host");
        if (origin && host && new URL(origin).host !== host) {
          return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
        }
        // JSON payload cap (multipart uploads have their own per-route caps).
        const contentType = req.headers.get("content-type") ?? "";
        const contentLength = Number(req.headers.get("content-length") ?? 0);
        if (contentType.includes("application/json") && contentLength > 1_000_000) {
          return NextResponse.json({ error: "Request body too large" }, { status: 413 });
        }
      }
      const params = await context.params;
      return await handler(req, params ?? {});
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, details: err.details ?? undefined },
          { status: err.status }
        );
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid input", details: err.flatten() },
          { status: 400 }
        );
      }
      console.error("API error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
