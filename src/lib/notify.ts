import { prisma } from "@/lib/db";
import { sendPushToUsers, type PushPayload } from "@/lib/push";

// One entry point for user-facing alerts: writes the in-app notification row
// AND fires a device push (when the user has enabled notifications).

export async function notifyUsers(
  userIds: string[],
  message: { title: string; body: string; url?: string; flagId?: string }
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  await prisma.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      flagId: message.flagId,
      title: message.title,
      body: message.body,
    })),
  });

  const payload: PushPayload = {
    title: message.title,
    body: message.body,
    url: message.url,
  };
  await sendPushToUsers(unique, payload).catch((err) =>
    console.error("[notify] push delivery failed", err)
  );
}

/** All active owners. */
export async function ownerUserIds(): Promise<string[]> {
  const owners = await prisma.user.findMany({
    where: { isOwner: true, isActive: true },
    select: { id: true },
  });
  return owners.map((o) => o.id);
}

/** Users holding a given role on a site. */
export async function siteRoleUserIds(
  siteId: string,
  role: "engineer" | "accounts"
): Promise<string[]> {
  const roles = await prisma.siteRole.findMany({
    where: { siteId, role },
    select: { userId: true },
  });
  return roles.map((r) => r.userId);
}
