import { Elysia, t } from "elysia";
import { promocodes } from "../../db/schema";
import { eq } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const promocodesRoutes = new Elysia({ prefix: "/promocodes" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allPromocodes = await db.select().from(promocodes);
    set.status = 200;
    return { success: true, data: allPromocodes };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      try {
        if (!body.code?.trim() || !body.type?.trim() || !body.value?.trim()) {
          set.status = 400;
          return {
            success: false,
            error: "Code, type, and value are required",
          };
        }

        const values = {
          ...body,
          validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
          validTo: body.validTo ? new Date(body.validTo) : undefined,
        };

        const [promocode] = await db
          .insert(promocodes)
          .values(values)
          .returning();
        set.status = 201;
        return { success: true, data: promocode };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create promocode",
        };
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 50 }),
        type: t.String({ minLength: 1, maxLength: 50 }),
        value: t.String({ minLength: 1, maxLength: 100 }),
        usageLimit: t.Optional(t.Number({ minimum: 1 })),
        validFrom: t.Optional(t.String()),
        validTo: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      const [updated] = await db
        .update(promocodes)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(promocodes.id, parseInt(params.id)))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        code: t.Optional(t.String()),
        type: t.Optional(t.String()),
        value: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, db, set }) => {
    await db.delete(promocodes).where(eq(promocodes.id, parseInt(params.id)));
    set.status = 200;
    return { success: true };
  });
