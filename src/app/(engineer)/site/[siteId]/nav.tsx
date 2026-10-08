"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrickWall,
  ClipboardList,
  HardHat,
  ScanLine,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { pillItem, pillTrack } from "@/components/ui/pill-tabs";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "progress", label: "Progress", icon: TrendingUp },
  { href: "inventory", label: "Stock", icon: BrickWall },
  { href: "scan", label: "Scan", icon: ScanLine },
  { href: "requisitions", label: "Requests", icon: ClipboardList },
  { href: "labour", label: "Labour", icon: HardHat },
];

export function EngineerNav({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  return (
    // Floating pill above the home indicator; the layout's pb-24 keeps the
    // last card clear of it.
    <nav
      aria-label="Site sections"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <ul className={cn(pillTrack({ floating: true }), "grid grid-cols-5 gap-1")}>
        {TABS.map((tab) => {
          const href = `/site/${siteId}/${tab.href}`;
          const active = pathname.startsWith(href);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  pillItem({ active }),
                  // ≥48px tap targets — gloves + sunlight on site.
                  "flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px]",
                )}
              >
                <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
