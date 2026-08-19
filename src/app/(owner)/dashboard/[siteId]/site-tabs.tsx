"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "gantt", label: "Gantt & Schedule" },
  { slug: "consumption", label: "Consumption" },
  { slug: "labour", label: "Labour" },
  { slug: "contractors", label: "Contractors" },
  { slug: "inventory", label: "Inventory" },
  { slug: "scans", label: "Scans" },
  { slug: "amendments", label: "Amendments" },
  { slug: "approvals", label: "Approvals" },
  { slug: "config", label: "Setup" },
];

export function SiteTabs({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/${siteId}`;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
      {TABS.map((tab) => {
        const href = tab.slug ? `${base}/${tab.slug}` : base;
        const active = tab.slug
          ? pathname.startsWith(href)
          : pathname === base;
        return (
          <Link
            key={tab.slug}
            href={href}
            className={cn(
              "whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium",
              active
                ? "border-b-2 border-brand-600 bg-white text-brand-700"
                : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
