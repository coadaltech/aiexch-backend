import { Elysia, t } from "elysia";
import { db } from "../../db";
import { sports, sportsGames } from "../../db/schema";
import { eq } from "drizzle-orm";

export const sportsGamesRoutes = new Elysia({ prefix: "/sports-games" })
  .get("/", async ({ set }) => {
    try {
      const games = await db.select().from(sports);
      console.log("gaa",games)
      set.status = 200;
      return { success: true, data: games };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch sports games" };
    }
  })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const [game] = await db
          .insert(sportsGames)
          .values({
            eventType: body.eventType,
            name: body.name,
            imageUrl: body.imageUrl,
            linkPath: body.linkPath,
            marketCount: body.marketCount || 0,
            status: body.status || "active",
          })
          .returning();
        set.status = 201;
        return { success: true, data: game };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to create sports game" };
      }
    },
    {
      body: t.Object({
        eventType: t.String(),
        name: t.String(),
        imageUrl: t.Optional(t.String()),
        linkPath: t.Optional(t.String()),
        marketCount: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const [game] = await db
          .update(sportsGames)
          .set({
            eventType: body.eventType,
            name: body.name,
            imageUrl: body.imageUrl,
            linkPath: body.linkPath,
            marketCount: body.marketCount,
            status: body.status,
            updatedAt: new Date(),
          })
          .where(eq(sportsGames.id, parseInt(params.id)))
          .returning();
        set.status = 200;
        return { success: true, data: game };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update sports game" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        eventType: t.String(),
        name: t.String(),
        imageUrl: t.Optional(t.String()),
        linkPath: t.Optional(t.String()),
        marketCount: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .delete("/:id", async ({ params, set }) => {
    try {
      await db.delete(sportsGames).where(eq(sportsGames.id, parseInt(params.id)));
      set.status = 200;
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to delete sports game" };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
