import { Elysia, t } from "elysia";
import { vouchers, voucherDetails, users } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const vouchersRoutes = new Elysia({ prefix: "/vouchers" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allVouchers = await db.select().from(vouchers);

    // Fetch amounts from voucher_details (target user row for each voucher)
    const voucherIds = allVouchers.map((v) => v.id);
    const details =
      voucherIds.length > 0
        ? await db
            .select({
              voucherId: voucherDetails.voucherId,
              amount: voucherDetails.amount,
            })
            .from(voucherDetails)
            .where(inArray(voucherDetails.voucherId, voucherIds))
        : [];

    // Build a map: voucherId → amount (pick first match per voucher)
    const amountMap = new Map<string, string>();
    for (const d of details) {
      if (d.voucherId && !amountMap.has(d.voucherId)) {
        amountMap.set(d.voucherId, d.amount ?? "0");
      }
    }

    const vouchersWithAmount = allVouchers.map((v) => ({
      ...v,
      amount: amountMap.get(v.id) ?? "0",
    }));

    set.status = 200;
    return { success: true, data: vouchersWithAmount };
  })

  .post(
    "/",
    async ({ body, set, db, store }) => {
      const adminId = (store as { id?: string })?.id || null;
      const amount = parseFloat(body.amount);

      if (isNaN(amount) || amount <= 0) {
        set.status = 400;
        return { success: false, message: "Invalid amount" };
      }

      // Look up target user
      const [user] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, body.userId));

      if (!user) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      // Look up creator role
      let creatorRole: string | null = null;
      let creatorGroupId: number | null = null;
      if (adminId) {
        const [creator] = await db
          .select({ groupId: users.groupId, role: users.role })
          .from(users)
          .where(eq(users.id, adminId));
        creatorRole = creator?.role ?? null;
        creatorGroupId = creator?.groupId ?? null;
      }

      // Source account for the debit side:
      //   Owner → Limit Account (system account, group_id=0)
      //   Everyone else → their own account
      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";
      const isOwner = creatorRole === "owner";
      const sourceAccountId = isOwner ? LIMIT_ACCOUNT_ID : adminId;
      const sourceGroupId = isOwner ? 0 : creatorGroupId;
      const sourceRole = isOwner ? "limit" : (creatorRole || "owner");

      const status = body.status || "approved";
      const isDebit = body.type === "debit" || body.type === "withdraw";

      // Insert voucher (no amount — amounts go in voucher_details only)
      // If status is 'approved' and voucher_details are inserted,
      // the DB trigger on voucher_details updates ledger_limit automatically.
      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: body.userId,
            userGroupId: user.groupId,
            type: body.type,
            ledgerField: body.ledgerField,
            status,
            remarks: body.remarks,
            method: body.method,
            reference: body.reference,
            createdBy: adminId,
            approvedBy: status === "approved" ? adminId : null,
            approvedAt: status === "approved" ? new Date() : null,
          })
          .returning();

        // Double-entry: 2 voucher_detail rows
        // For credit/limit/deposit/bonus: CREDIT user, DEBIT source
        // For debit/withdraw: DEBIT user, CREDIT source

        // Row 1: Target user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: body.userId,
          userGroupId: user.groupId,
          amount: body.amount,
          drCr: isDebit ? "DEBIT" : "CREDIT",
          accountType: "ledger",
          role: user.role || "user",
          whitelabelId: user.whitelabelId,
          description: body.type + " voucher - " + (isDebit ? "debit from" : "credit to") + " user",
        });

        // Row 2: Source account
        // Owner → Limit Account | Others → their own account
        if (sourceAccountId) {
          await tx.insert(voucherDetails).values({
            voucherId: voucher.id,
            userId: sourceAccountId,
            userGroupId: sourceGroupId,
            amount: body.amount,
            drCr: isDebit ? "CREDIT" : "DEBIT",
            accountType: "ledger",
            role: sourceRole,
            whitelabelId: user.whitelabelId,
            description: body.type + " voucher - " + (isDebit ? "credit to" : "debit from") + " " + sourceRole,
          });
        }

        return voucher;
      });

      set.status = 201;
      return { success: true, data: result };
    },
    {
      body: t.Object({
        userId: t.String(),
        type: t.String(), // limit | credit | debit | deposit | withdraw | bonus
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
      // (trg_voucher_approve) processes all voucher_detail rows
      // and updates ledger_limit automatically.
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
