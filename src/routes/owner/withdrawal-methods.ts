import { Elysia, t } from "elysia";
import { db } from "../../db";
import { withdrawalMethods } from "../../db/schema";
import { eq } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { UserRole } from "../../types/enums";

export const withdrawalMethodsRoutes = new Elysia({
  prefix: "/withdrawal-methods",
})
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .guard({
    beforeHandle({ userRole, set, whitelabel }: any) {
      if (userRole === UserRole.Owner) {
        set.status = 403;
        return { success: false, message: "Withdrawal Methods are managed by whitelabel admins, not the owner" };
      }
      const wlType = whitelabel?.whitelabelType
        ? String(whitelabel.whitelabelType).toUpperCase()
        : null;
      if (wlType !== "B2C") {
        set.status = 403;
        return { success: false, message: "Withdrawal Methods are only available for B2C whitelabels" };
      }
    },
  })
  .get("/", async ({ set, db }) => {
    const methods = await db.select().from(withdrawalMethods);
    set.status = 200;
    return { success: true, data: methods };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      const [method] = await db
        .insert(withdrawalMethods)
        .values({ ...body, status: body.status || "active" })
        .returning();
      set.status = 201;
      return { success: true, data: method };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        type: t.String({ minLength: 1, maxLength: 50 }),
        currency: t.Optional(t.String()),
        minAmount: t.Optional(t.String()),
        maxAmount: t.Optional(t.String()),
        processingTime: t.Optional(t.String()),
        feePercentage: t.Optional(t.String()),
        feeFixed: t.Optional(t.String()),
        instructions: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      const [updated] = await db
        .update(withdrawalMethods)
        .set({ ...body, updateDate: new Date() })
        .where(eq(withdrawalMethods.id, params.id))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        type: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        minAmount: t.Optional(t.String()),
        maxAmount: t.Optional(t.String()),
        processingTime: t.Optional(t.String()),
        feePercentage: t.Optional(t.String()),
        feeFixed: t.Optional(t.String()),
        instructions: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, set, db }) => {
    await db
      .delete(withdrawalMethods)
      .where(eq(withdrawalMethods.id, params.id));
    set.status = 200;
    return { success: true };
  });
