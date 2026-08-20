import { redirect } from "next/navigation";
import Link from "next/link";
import { pageCtx } from "@/lib/auth/page-guard";
import { prisma } from "@/lib/db";
import { SignOutButton } from "@/components/SignOutButton";
import { EnablePushButton } from "@/components/EnablePushButton";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx();
  if (!ctx.isOwner) redirect("/no-access");

  const unread = await prisma.notification.count({
    where: { userId: ctx.userId, readAt: null },
  });

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-base">
              🏗️
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-900">
                Construction ERP
              </p>
              <p className="text-[11px] leading-tight text-slate-400">Owner console</p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/notifications"
              className="relative rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            >
              🔔
              {unread > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
            <EnablePushButton />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
