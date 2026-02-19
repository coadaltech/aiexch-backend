import { Elysia, t } from "elysia";
import { notifications } from "../../db/schema";
import { eq } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const notificationsRoutes = new Elysia({ prefix: "/notifications" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allNotifications = await db.select().from(notifications);
    set.status = 200;
    return { success: true, data: allNotifications };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      const [notification] = await db
        .insert(notifications)
        .values(body)
        .returning();
      set.status = 201;
      return { success: true, data: notification };
    },
    {
      body: t.Object({
        title: t.String(),
        message: t.String(),
        type: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      const [updated] = await db
        .update(notifications)
        .set(body)
        .where(eq(notifications.id, parseInt(params.id)))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        message: t.Optional(t.String()),
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, set, db }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      set.status = 400;
      throw new Error("Invalid notification ID");
    }

    // Check if notification exists
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    if (existing.length === 0) {
      set.status = 404;
      throw new Error("Notification not found");
    }

    await db.delete(notifications).where(eq(notifications.id, id));

    set.status = 200;
    return { success: true, message: "Notification deleted successfully" };
  });
