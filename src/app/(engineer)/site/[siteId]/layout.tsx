import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { SignOutButton } from "@/components/SignOutButton";
import { EnablePushButton } from "@/components/EnablePushButton";
import { EngineerNav } from "./nav";

export default async function EngineerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);
  const site = await prisma.site.findUnique({ where: { id: siteId } });

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-surface">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-600">
              Site Engineer
            </p>
            <h1 className="text-base font-semibold leading-tight text-slate-900">
              {site?.name ?? "Site"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <EnablePushButton />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 px-3 pb-24 pt-4">{children}</main>
      <EngineerNav siteId={siteId} />
    </div>
  );
}
