import { Elysia, t } from "elysia";
import { vouchers, voucherDetails, users } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import {
  UserRole,
  VoucherType,
  VoucherStatus,
  DrCr,
  parseVoucherType,
  parseVoucherStatus,
  voucherTypeToString,
  voucherStatusToString,
} from "../../types/enums";

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
      type: voucherTypeToString(v.type),
      status: voucherStatusToString(v.status),
      amount: amountMap.get(v.id) ?? "0",
    }));

    set.status = 200;
    return { success: true, data: vouchersWithAmount };
  })

  .post(
    "/",
    async ({ body, set, db, store }) => {
      const adminId = (store as { id?: string })?.id;
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
      let creatorRole: number | null = null;
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
      const isOwner = creatorRole === UserRole.Owner;
      const sourceAccountId = isOwner ? LIMIT_ACCOUNT_ID : adminId;
      const sourceRoleInt = creatorRole ?? UserRole.Owner;

      const voucherType = parseVoucherType(body.type);
      const voucherStatus = parseVoucherStatus(body.status || "approved");
      const isDebit = body.type === "debit" || body.type === "withdraw";

      // Insert voucher (no amount — amounts go in voucher_details only)
      // If status is 'approved' and voucher_details are inserted,
      // the DB trigger on voucher_details updates ledger_limit automatically.
      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: body.userId,
            type: voucherType,
            status: voucherStatus,
            remarks: body.remarks,
            method: body.method,
            reference: body.reference,
            addedBy: adminId,
            approvedBy: voucherStatus === VoucherStatus.Approved ? adminId : null,
            approvedDate: voucherStatus === VoucherStatus.Approved ? new Date().toISOString().split("T")[0] : null,
          })
          .returning();

        // Double-entry: 2 voucher_detail rows
        // For credit/limit/deposit/bonus: CREDIT user, DEBIT source
        // For debit/withdraw: DEBIT user, CREDIT source

        // Row 1: Target user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: body.userId,
          amount: body.amount,
          drCr: isDebit ? DrCr.Debit : DrCr.Credit,
          oppositeUserId: sourceAccountId,
          role: user.role ?? UserRole.User,
          whitelabelId: user.whitelabelId,
          description: body.type + " voucher - " + (isDebit ? "debit from" : "credit to") + " user",
        });

        // Row 2: Source account
        // Owner → Limit Account | Others → their own account
        if (sourceAccountId) {
          await tx.insert(voucherDetails).values({
            voucherId: voucher.id,
            userId: sourceAccountId,
            amount: body.amount,
            drCr: isDebit ? DrCr.Credit : DrCr.Debit,
            oppositeUserId: body.userId,
            role: sourceRoleInt,
            whitelabelId: user.whitelabelId,
            description: body.type + " voucher - " + (isDebit ? "credit to" : "debit from") + " source",
          });
        }

        return voucher;
      });

      set.status = 201;
      return {
        success: true,
        data: {
          ...result,
          type: voucherTypeToString(result.type),
          status: voucherStatusToString(result.status),
        },
      };
    },
    {
      body: t.Object({
        userId: t.String(),
        type: t.String(), // limit | credit | debit | deposit | withdraw | bonus
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

      const statusInt = parseVoucherStatus(body.status);
      const updateData: Record<string, any> = {
        status: statusInt,
        updateDate: new Date().toISOString().split("T")[0],
      };

      // Set approvedBy/approvedDate when approving or rejecting
      if (statusInt === VoucherStatus.Approved || statusInt === VoucherStatus.Rejected) {
        updateData.approvedBy = adminId;
        updateData.approvedDate = new Date().toISOString().split("T")[0];
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
      return {
        success: true,
        data: {
          ...updated,
          type: voucherTypeToString(updated.type),
          status: voucherStatusToString(updated.status),
        },
      };
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
