import { Elysia, t } from "elysia";
import { vouchers, voucherDetails, users } from "../../db/schema";
import { eq } from "drizzle-orm";
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
    async ({ body, set, db, store }) => {
      const adminId = (store as { id?: string })?.id || null;

      // Look up user's groupId
      const [user] = await db
        .select({ groupId: users.groupId })
        .from(users)
        .where(eq(users.id, body.userId));

      const userGroupId = user?.groupId ?? null;
      const status = body.status || "approved";

      // Insert voucher — if status is 'approved', the DB trigger
      // automatically updates ledger_limit (no manual update needed).
      const [voucher] = await db
        .insert(vouchers)
        .values({
          userId: body.userId,
          userGroupId,
          type: body.type,
          ledgerField: body.ledgerField,
          amount: body.amount,
          status,
          remarks: body.remarks,
          method: body.method,
          reference: body.reference,
          createdBy: adminId,
          approvedBy: status === "approved" ? adminId : null,
          approvedAt: status === "approved" ? new Date() : null,
        })
        .returning();

      set.status = 201;
      return { success: true, data: voucher };
    },
    {
      body: t.Object({
        userId: t.String(),
        type: t.String(), // limit | credit | debit | deposit | withdraw | bonus | settlement
        ledgerField: t.Optional(t.String()), // user_balance | user_limit | both
        amount: t.String(),
        status: t.Optional(t.String()),
        remarks: t.Optional(t.String()),
        method: t.Optional(t.String()),
        reference: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db, store }) => {
      const adminId = (store as { id?: string })?.id || null;
      const voucherId = params.id;

      const updateData: Record<string, any> = {
        status: body.status,
        updatedAt: new Date(),
      };

      // Set approvedBy/approvedAt when approving or rejecting
      if (body.status === "approved" || body.status === "rejected") {
        updateData.approvedBy = adminId;
        updateData.approvedAt = new Date();
      }

      if (body.remarks) {
        updateData.remarks = body.remarks;
      }

      // Update status — if changing to 'approved', the DB trigger
      // automatically updates ledger_limit (no manual update needed).
      const [updated] = await db
        .update(vouchers)
        .set(updateData)
        .where(eq(vouchers.id, voucherId))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, message: "Voucher not found" };
      }

      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        status: t.Union([
          t.Literal("pending"),
          t.Literal("approved"),
          t.Literal("rejected"),
        ]),
        remarks: t.Optional(t.String()),
      }),
    }
  );
