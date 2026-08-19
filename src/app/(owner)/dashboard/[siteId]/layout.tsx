import Link from "next/link";
import { prisma } from "@/lib/db";
import { SiteTabs } from "./site-tabs";

export default async function SiteDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId } });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard" className="text-xs font-medium text-brand-700 hover:underline">
          ← All sites
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{site?.name ?? "Site"}</h1>
      </div>
      <SiteTabs siteId={siteId} />
      <div>{children}</div>
    </div>
  );
}
