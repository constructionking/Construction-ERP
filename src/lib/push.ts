import webpush from "web-push";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Web-push delivery. Degrades gracefully: without VAPID keys every call
// no-ops and users still get in-app notifications.

let configured = false;

export function pushEnabled(): boolean {
  return env.VAPID_PUBLIC_KEY.length > 0 && env.VAPID_PRIVATE_KEY.length > 0;
}

function ensureConfigured() {
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  /** in-app path opened when the notification is tapped */
  url?: string;
}

/** Send a push to every registered device of the given users. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushEnabled() || userIds.length === 0) return;
  ensureConfigured();

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        // 404/410 = the browser dropped the subscription — clean it up.
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription
            .delete({ where: { endpoint: subscription.endpoint } })
            .catch(() => {});
        } else {
          console.error("[push] send failed", statusCode ?? err);
        }
      }
    })
  );
}
