import { db } from "@db/index";
import { userNotifications } from "@db/schema";
import { broadcastUserNotification } from "./sports-broadcast";

export type NewUserNotification = {
  userId: string;
  type?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Persist one targeted notification per item and push each to its user over the
 * "user-notifications" WS channel. Persistence means offline users still see it
 * on the header bell next time they load; the WS push makes it instant for
 * users currently online (regardless of which page they're on).
 */
export async function createUserNotifications(items: NewUserNotification[]) {
  if (!items.length) return [];

  const rows = items.map((n) => ({
    userId: n.userId,
    type: n.type ?? "info",
    title: n.title,
    message: n.message,
    data: n.data ?? {},
  }));

  const inserted = await db.insert(userNotifications).values(rows).returning();

  for (const n of inserted) {
    broadcastUserNotification(n.userId, {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      isRead: n.isRead,
      addedDate: n.addedDate,
    });
  }

  return inserted;
}
