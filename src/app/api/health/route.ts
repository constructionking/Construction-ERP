import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public, unauthenticated health probe for uptime monitors, the container
// health check, and post-deploy smoke tests. Pings the DB with a trivial
// query so a green result means "app up AND database reachable".
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
