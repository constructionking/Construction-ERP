"use client";

import { useRouter } from "next/navigation";

export function MarkAllRead({ ids }: { ids: string[] }) {
  const router = useRouter();
  return (
    <button
      className="text-xs font-medium text-brand-700 hover:underline"
      onClick={async () => {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        router.refresh();
      }}
    >
      Mark all read
    </button>
  );
}
