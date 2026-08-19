import { pageCtx } from "@/lib/auth/page-guard";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { MarkAllRead } from "./mark-all-read";

export default async function NotificationsPage() {
  const ctx = await pageCtx();
  const notifications = await prisma.notification.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Notifications</CardTitle>
          {unreadIds.length > 0 ? <MarkAllRead ids={unreadIds} /> : null}
        </div>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={
                  notification.readAt
                    ? "rounded-lg bg-slate-50 px-3 py-2.5 opacity-70"
                    : "rounded-lg border border-brand-200 bg-brand-50/40 px-3 py-2.5"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{notification.title}</p>
                    <p className="text-xs text-slate-500">{notification.body}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {notification.createdAt.toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
