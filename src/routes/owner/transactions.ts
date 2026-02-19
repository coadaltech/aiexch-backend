import { Elysia, t } from "elysia";
import { transactions, users } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const transactionsRoutes = new Elysia({ prefix: "/transactions" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allTransactions = await db.select().from(transactions);
    set.status = 200;
    return { success: true, data: allTransactions };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      const [transaction] = await db
        .insert(transactions)
        .values(body)
        .returning();
      set.status = 201;
      return { success: true, data: transaction };
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
      const transactionId = parseInt(params.id);
      const [updated] = await db
        .update(transactions)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(transactions.id, transactionId))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, message: "Transaction not found" };
      }

      if (updated.status === "completed" && updated.type === "deposit") {
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
