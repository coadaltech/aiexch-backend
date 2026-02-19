import { Elysia, t } from "elysia";
import { casino_games } from "../../db/schema";
import { eq } from "drizzle-orm";
import { whitelabel_middleware } from "@middleware/whitelabel";
import { DbType } from "../../types";

export const casinoGamesOwnerRoutes = new Elysia({
  prefix: "/casino-games",
})
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ db, set }) => {
    try {
      const data = await db.select().from(casino_games);
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch casino games" };
    }
  })

  .post(
    "/",
    async ({ body, db, set }) => {
      try {
        const [data] = await db.insert(casino_games).values(body).returning();
        set.status = 201;
        return { success: true, data };
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to create casino game" };
      }
    },
    {
      body: t.Object({
        uuid: t.String(),
        name: t.String(),
        image: t.String(),
        type: t.String(),
        provider: t.String(),
        provider_id: t.Number(),
        technology: t.String(),
        has_lobby: t.Optional(t.Boolean()),
        is_mobile: t.Optional(t.Boolean()),
        has_freespins: t.Optional(t.Boolean()),
        has_tables: t.Optional(t.Boolean()),
        tags: t.Optional(t.Array(t.Any())),
        label: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, db, set }) => {
      try {
        const [data] = await db
          .update(casino_games)
          .set(body)
          .where(eq(casino_games.id, params.id))
          .returning();
        set.status = 200;
        return { success: true, data };
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to update casino game" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Partial(
        t.Object({
          name: t.String(),
          image: t.String(),
          type: t.String(),
          provider: t.String(),
          provider_id: t.Number(),
          technology: t.String(),
          has_lobby: t.Boolean(),
          is_mobile: t.Boolean(),
          has_freespins: t.Boolean(),
          has_tables: t.Boolean(),
          tags: t.Array(t.Any()),
          label: t.String(),
        })
      ),
    }
  )

  .delete(
    "/:id",
    async ({ params, db, set }) => {
      try {
        await db.delete(casino_games).where(eq(casino_games.id, params.id));
        set.status = 200;
        return { success: true };
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to delete casino game" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
