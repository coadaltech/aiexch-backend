import { Elysia, t } from "elysia";
import { vouchers, users } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const vouchersRoutes = new Elysia({ prefix: "/vouchers" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allVouchers = await db.select().from(vouchers);
    set.status = 200;
    return { success: true, data: allVouchers };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      const [voucher] = await db
        .insert(vouchers)
        .values(body)
        .returning();

      // Automatically add to user balance if deposit/bonus and status is completed
      if (
        (voucher.type === "deposit" || voucher.type === "bonus") &&
        voucher.status === "completed"
      ) {
        await db
          .update(users)
          .set({
            balance: sql`${users.balance} + ${voucher.amount}`,
          })
          .where(eq(users.id, voucher.userId));
      }

      set.status = 201;
      return { success: true, data: voucher };
    },
    {
      body: t.Object({
        userId: t.Number(),
        type: t.String(),
        amount: t.String(),
        currency: t.Optional(t.String()),
        method: t.Optional(t.String()),
        reference: t.Optional(t.String()),
        txnHash: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      const voucherId = parseInt(params.id);
      const [updated] = await db
        .update(vouchers)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(vouchers.id, voucherId))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, message: "Voucher not found" };
      }

      if (updated.status === "completed" && (updated.type === "deposit" || updated.type === "bonus")) {
        await db
          .update(users)
          .set({
            balance: sql`${users.balance} + ${updated.amount}`,
          })
          .where(eq(users.id, updated.userId));
      } else if (updated.status === "failed" && updated.type === "withdraw") {
        // Refund balance for rejected withdrawals
        await db
          .update(users)
          .set({
            balance: sql`${users.balance} + ${updated.amount}`,
          })
          .where(eq(users.id, updated.userId));
      }

      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        status: t.Union([
          t.Literal("pending"),
          t.Literal("completed"),
          t.Literal("failed"),
        ]),
      }),
    }
  );
