"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "progress", label: "Progress", icon: "📈" },
  { href: "inventory", label: "Stock", icon: "🧱" },
  { href: "scan", label: "Scan", icon: "📷" },
  { href: "requisitions", label: "Requests", icon: "📝" },
  { href: "labour", label: "Labour", icon: "👷" },
];

export function EngineerNav({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 mx-auto max-w-lg border-t border-slate-200 bg-white">
      <div className="grid grid-cols-5">
        {TABS.map((tab) => {
          const href = `/site/${siteId}/${tab.href}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.href}
              href={href}
              className={cn(
                // ≥48px tap targets — gloves + sunlight on site.
                "flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium",
                active ? "text-brand-700" : "text-slate-400"
              )}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
