import { Elysia, t } from "elysia";
import {
  notifications,
  profiles,
  promocodes,
  vouchers,
  voucherDetails,
  userReadNotifications,
  users,
  ledgerLimit,
  transactionsDeclare,
  transactionDetailsDeclare,
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { getEffectivePermissions } from "../services/permissions";
import { increment } from "../utils/numbers";
import { uploadFile } from "../services/s3";
import { getCurrentIP } from "../utils/user-ip";
import { lookupGeo } from "../utils/geo";
import { comparePassword, generateHashPassword } from "../utils/password";
import { whitelabel_middleware } from "../middleware/whitelabel";
import { DbType } from "../types";
import {
  MembershipType,
  VoucherType,
  VoucherStatus,
  DrCr,
  UserRole,
  parseVoucherType,
  voucherTypeToString,
  voucherStatusToString,
} from "../types/enums";

export const profileRoutes = new Elysia({ prefix: "/profile" })
  // Per-request user context via .resolve() (NOT .state(), which is module-shared
  // and would leak userId across concurrent requests).
  .resolve(async ({ cookie, headers, status }) => {
    const state_result = await app_middleware({ cookie, headers });
    if (!state_result.data) {
      return status(state_result.code as 401 | 403 | 404 | 500, state_result);
    }
    return {
      userId: state_result.data.id,
      userRole: state_result.data.role,
    };
  })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any; dbError?: string }> => {
    const { db, whitelabel, dbError } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel, dbError };
  })
  .onBeforeHandle(({ dbError, set }) => {
    if (dbError === "DATABASE_NOT_FOUND") {
      set.status = 503;
      return {
        success: false,
        error: "DATABASE_NOT_FOUND",
        message: "Database not found. Please contact the owner to create the database.",
      };
    }
  })

  .get("/me", async ({ userId, set, db, headers, request }) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const canLogin = (user?.accountStatus ?? true) && (user?.parentAccountStatus ?? true);
    if (!user || !canLogin) {
      set.status = 401;
      return { loggedIn: false };
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    // transactionLimit is the per-bet cap. The bet UI reads this off the
    // logged-in user so it can clamp the stake input before submission.
    const [ledger] = await db
      .select({ transactionLimit: ledgerLimit.transactionLimit })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, userId))
      .limit(1);

    const geo = lookupGeo(getCurrentIP(headers, request));

    // Effective staff permissions — empty array for regular users (role=User),
    // full catalog for Owner, derived from staff role + overrides for staff.
    const permissionSet =
      user.role === UserRole.User
        ? new Set<string>()
        : await getEffectivePermissions(user.id, { userRole: user.role, db });

    set.status = 200;
    return {
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        membership: profile?.membership ?? MembershipType.Bronze,
        upline: profile?.upline ?? "0.00",
        downline: profile?.downline ?? "0.00",
        groupId: user.groupId,
        currencyId: profile?.currencyId ?? null,
        country: geo.country ?? profile?.country ?? null,
        timezone: geo.timezone ?? null,
        transactionLimit: ledger?.transactionLimit ?? "0",
        permissions: Array.from(permissionSet),
        isStaff: user.isStaff ?? false,
        parentUserId: user.parentUserId ?? null,
      },
    };
  })
  .get("/", async ({ userId, set, db }) => {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      set.status = 404;
      return { success: false, message: "User not found" };
    }

    set.status = 200;
    return {
      success: true,
      profile: {
        ...profile,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  })

  .get("/balance", async ({ userId, set, db }) => {
    const [ledger] = await db
      .select({ finalLimit: ledgerLimit.finalLimit })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, userId))
      .limit(1);

    set.status = 200;
    return {
      success: true,
      balance: ledger?.finalLimit || "0",
    };
  })

  .put(
    "/",
    async ({ body, userId, set, db }) => {
      const [existingProfile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

      // Validate birth date if provided
      if (body.birthDate) {
        const birthDate = new Date(body.birthDate);
        const today = new Date();
        const age = today.getFullYear() - birthDate.getFullYear();
        if (age < 18) {
          set.status = 400;
          return { success: false, message: "Must be 18 years or older" };
        }
      }

      let updatedProfile;

      if (!existingProfile) {
        // Create profile if it doesn't exist
        [updatedProfile] = await db
          .insert(profiles)
          .values({
            userId: userId,
            ...body,
          })
          .returning();
      } else {
        // Update existing profile
        [updatedProfile] = await db
          .update(profiles)
          .set({
            ...body,
          })
          .where(eq(profiles.userId, userId))
          .returning();
      }

      set.status = 200;
      return {
        success: true,
        profile: updatedProfile,
      };
    },
    {
      body: t.Object({
        firstName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        lastName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        birthDate: t.Optional(t.String({ format: "date" })),
        country: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        city: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        address: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        phone: t.Optional(t.String({ minLength: 10, maxLength: 20 })),
        avatar: t.Optional(t.String({ format: "uri" })),
      }),
    }
  )

  // Get stake settings
  .get("/stake-settings", async ({ userId, set, db }) => {
    const DEFAULT_STAKES = [
      { label: "100",       value: 100     },
      { label: "500",       value: 500     },
      { label: "1,000",     value: 1000    },
      { label: "5,000",     value: 5000    },
      { label: "10,000",    value: 10000   },
      { label: "50,000",    value: 50000   },
      { label: "1,00,000",  value: 100000  },
      { label: "5,00,000",  value: 500000  },
      { label: "10,00,000", value: 1000000 },
    ];
    try {
      const [profile] = await db
        .select({ stakeSettings: profiles.stakeSettings })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);
      const stakes = profile?.stakeSettings as any[] | null;
      set.status = 200;
      return { success: true, data: stakes && stakes.length > 0 ? stakes : DEFAULT_STAKES };
    } catch {
      set.status = 200;
      return { success: true, data: DEFAULT_STAKES };
    }
  })

  // Save stake settings
  .put("/stake-settings", async ({ userId, set, db, body }) => {
    const stakes = (body as any)?.stakes;
    if (!Array.isArray(stakes) || stakes.length === 0) {
      set.status = 400;
      return { success: false, error: "Invalid stakes array" };
    }
    // Validate each entry
    const validated = stakes.slice(0, 9).map((s: any) => ({
      label: String(s.label ?? "").slice(0, 20),
      value: Math.max(0, Math.floor(Number(s.value) || 0)),
    }));
    await db
      .update(profiles)
      .set({ stakeSettings: validated, updateBy: userId, updateDate: new Date() })
      .where(eq(profiles.userId, userId));
    set.status = 200;
    return { success: true, data: validated };
  })

  // Get user transactions (queries vouchers table but endpoint name remains "transactions" for user-facing API)
  .get("/transactions", async ({ query, userId, set, db }) => {
    let whereConditions = [eq(vouchers.userId, userId)];

    if (query.type && query.type !== "all") {
      whereConditions.push(eq(vouchers.type, parseVoucherType(query.type)));
    }

    const rows = await db
      .select({
        id: vouchers.id,
        type: vouchers.type,
        status: vouchers.status,
        method: vouchers.method,
        reference: vouchers.reference,
        remarks: vouchers.remarks,
        remarks1: vouchers.remarks1,
        approvedDate: vouchers.approvedDate,
        voucherDate: vouchers.voucherDate,
        addedDate: vouchers.addedDate,
        amount: voucherDetails.amount,
        drCr: voucherDetails.drCr,
        proofImage: voucherDetails.proofImage,
      })
      .from(vouchers)
      .leftJoin(
        voucherDetails,
        and(
          eq(voucherDetails.voucherId, vouchers.id),
          eq(voucherDetails.userId, userId),
        )
      )
      .where(and(...whereConditions))
      .orderBy(desc(vouchers.addedDate));

    const mapped = rows.map((v) => ({
      ...v,
      type: voucherTypeToString(v.type),
      status: voucherStatusToString(v.status),
      amount: v.amount ?? "0",
      isCredit: v.drCr === DrCr.Credit,
    }));
    set.status = 200;
    return { success: true, data: mapped };
  })

  // Get user bet history
  .get("/bets", async ({ userId, query, set, db }) => {
    const { bets } = await import("../db/schema");

    let whereConditions = [eq(bets.userId, userId)];

    if (query.status && query.status !== "all") {
      whereConditions.push(eq(bets.status, query.status));
    }

    const queryBuilder = db
      .select()
      .from(bets)
      .where(and(...whereConditions));

    const userBets = await queryBuilder.orderBy(desc(bets.addedDate));
    set.status = 200;
    return { success: true, data: userBets };
  })

  // Get user bet history (alternative endpoint)
  .get("/bet-history", async ({ userId, query, set, db }) => {
    try {
      const { bets } = await import("../db/schema");

      let whereConditions = [eq(bets.userId, userId)];

      if (query.status && query.status !== "all") {
        whereConditions.push(eq(bets.status, query.status));
      }

      const userBets = await db
        .select()
        .from(bets)
        .where(and(...whereConditions))
        .orderBy(desc(bets.addedDate));

      set.status = 200;
      return { success: true, data: userBets };
    } catch (error) {
      set.status = 200;
      return { success: true, data: [] }; // Return empty array if table doesn't exist
    }
  })

  // Get user casino bet history (Ace / QTech). Mirrors /bet-history but for the
  // casino_transactions table so the Bet History page can show a casino section.
  .get("/casino-bet-history", async ({ userId, query, set, db }) => {
    try {
      const { casinoTransactions } = await import("../db/schema");

      let whereConditions = [
        eq(casinoTransactions.userId, userId),
        eq(casinoTransactions.recordStatus, 0),
      ];

      if (query.status && query.status !== "all") {
        whereConditions.push(eq(casinoTransactions.status, query.status));
      }

      const userCasinoBets = await db
        .select({
          id: casinoTransactions.id,
          provider: casinoTransactions.provider,
          gameName: casinoTransactions.gameName,
          selectionName: casinoTransactions.selectionName,
          betType: casinoTransactions.betType,
          stake: casinoTransactions.stake,
          odds: casinoTransactions.odds,
          exposure: casinoTransactions.exposure,
          status: casinoTransactions.status,
          settledAmount: casinoTransactions.settledAmount,
          payout: casinoTransactions.payout,
          outcome: casinoTransactions.outcome,
          placedAt: casinoTransactions.placedAt,
          settledAt: casinoTransactions.settledAt,
          addedDate: casinoTransactions.addedDate,
        })
        .from(casinoTransactions)
        .where(and(...whereConditions))
        .orderBy(desc(casinoTransactions.placedAt));

      set.status = 200;
      return { success: true, data: userCasinoBets };
    } catch (error) {
      set.status = 200;
      return { success: true, data: [] }; // Return empty array if table doesn't exist
    }
  })

  // Get user notifications
  .get("/notifications/user/:userId", async ({ params, set, db }) => {
    const userId = params.userId;
    const userNotifications = await db
      .select({
        id: notifications.id,
        title: notifications.title,
        message: notifications.message,
        type: notifications.type,
        addedDate: notifications.addedDate,
        isRead: userReadNotifications.isRead,
        readAt: userReadNotifications.readAt,
      })
      .from(notifications)
      .leftJoin(
        userReadNotifications,
        and(
          eq(userReadNotifications.notificationId, notifications.id),
          eq(userReadNotifications.userId, userId)
        )
      )
      .where(eq(notifications.status, "active"));

    set.status = 200;
    return { success: true, data: userNotifications };
  })
  // Mark notification as read
  .post(
    "/notifications/mark-read",
    async ({ body, set, db }) => {
      const [readNotification] = await db
        .insert(userReadNotifications)
        .values(body)
        .returning();
      set.status = 201;
      return { success: true, data: readNotification };
    },
    {
      body: t.Object({
        userId: t.String(),
        notificationId: t.String(),
      }),
    }
  )

  // Create deposit transaction (pending — admin must approve, trigger updates ledger)
  .post(
    "/deposit",
    async ({ body, userId, set, db }) => {
      let proofImageUrl: string | undefined;
      if (body.proofImage) {
        proofImageUrl = await uploadFile(body.proofImage);
      }

      // Get user info for double-entry
      const [user] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: userId,
            type: VoucherType.Deposit,
            status: VoucherStatus.Pending,
            method: body.method,
            reference: body.reference,
            addedBy: userId,
          })
          .returning();

        // Row 1: Credit to user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: userId,
          amount: body.amount,
          voucherType: VoucherType.Deposit,
          voucherDetailType: VoucherType.Deposit,
          drCr: DrCr.Credit,
          oppositeUserId: LIMIT_ACCOUNT_ID,
          role: user?.role ?? UserRole.User,
          proofImage: proofImageUrl,
          whitelabelId: user?.whitelabelId,
          description: "deposit voucher - credit to user",
        });

        // Row 2: Debit from limit account
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: LIMIT_ACCOUNT_ID,
          amount: body.amount,
          voucherType: VoucherType.Deposit,
          voucherDetailType: VoucherType.Deposit,
          drCr: DrCr.Debit,
          oppositeUserId: userId,
          role: UserRole.Owner,
          whitelabelId: user?.whitelabelId,
          description: "deposit voucher - debit from limit account",
        });

        return voucher;
      });

      set.status = 201;
      return { success: true, data: result };
    },
    {
      body: t.Object({
        amount: t.String(),
        method: t.String(),
        reference: t.Optional(t.String()),
        proofImage: t.File(),
      }),
    }
  )

  // Create withdrawal transaction (pending — balance deducted only on admin approval via trigger)
  .post(
    "/withdraw",
    async ({ body, userId, set, db }) => {
      const amount = parseFloat(body.amount);

      // Check cash balance in ledger_limit
      const [ledger] = await db
        .select({ userBalance: ledgerLimit.userBalance })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, userId))
        .limit(1);

      if (!ledger || parseFloat(ledger.userBalance || "0") < amount) {
        set.status = 400;
        return { success: false, message: "Insufficient balance" };
      }

      // Get user info for double-entry
      const [user] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: userId,
            type: VoucherType.Withdraw,
            status: VoucherStatus.Pending,
            method: body.method,
            reference: body.address,
            addedBy: userId,
          })
          .returning();

        // Row 1: Debit from user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: userId,
          amount: body.amount,
          voucherType: VoucherType.Withdraw,
          voucherDetailType: VoucherType.Withdraw,
          drCr: DrCr.Debit,
          oppositeUserId: LIMIT_ACCOUNT_ID,
          role: user?.role ?? UserRole.User,
          whitelabelId: user?.whitelabelId,
          description: "withdraw voucher - debit from user",
        });

        // Row 2: Credit to limit account
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: LIMIT_ACCOUNT_ID,
          amount: body.amount,
          voucherType: VoucherType.Withdraw,
          voucherDetailType: VoucherType.Withdraw,
          drCr: DrCr.Credit,
          oppositeUserId: userId,
          role: UserRole.Owner,
          whitelabelId: user?.whitelabelId,
          description: "withdraw voucher - credit to limit account",
        });

        return voucher;
      });

      set.status = 201;
      return { success: true, data: result };
    },
    {
      body: t.Object({
        amount: t.String(),
        method: t.String(),
        address: t.String(),
      }),
    }
  )

  // Redeem promocode
  .post(
    "/promocodes/redeem",
    async ({ body, userId, set, db }) => {
      const [promocode] = await db
        .select()
        .from(promocodes)
        .where(
          and(eq(promocodes.code, body.code), eq(promocodes.status, "active"))
        )
        .limit(1);

      if (!promocode) {
        set.status = 404;
        return { success: false, message: "Invalid or expired promocode" };
      }

      // Check expiry
      if (promocode.validTo && new Date(promocode.validTo) < new Date()) {
        set.status = 400;
        return { success: false, message: "Promocode has expired" };
      }

      // Check usage limit (skip if no limit set)
      if (
        promocode.usageLimit &&
        promocode.usageLimit > 0 &&
        (promocode.usedCount || 0) >= promocode.usageLimit
      ) {
        set.status = 400;
        return { success: false, message: "Promocode usage limit reached" };
      }

      const [existingRedemption] = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.userId, userId),
            eq(vouchers.type, VoucherType.Bonus),
            eq(vouchers.reference, promocode.code)
          )
        )
        .limit(1);

      if (existingRedemption) {
        set.status = 400;
        return { success: false, message: "Promocode already used" };
      }

      // Fetch user's cash balance from ledger for percentage-based promos
      const [ledger] = await db
        .select({ userBalance: ledgerLimit.userBalance })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, userId))
        .limit(1);

      if (!ledger) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      let bonusAmount = 0;
      const userBalance = parseFloat(ledger.userBalance || "0");

      // Calculate bonus based on types
      if (promocode.type === "percentage") {
        bonusAmount = (userBalance * parseFloat(promocode.value)) / 100;
      } else if (promocode.type === "fixed" || promocode.type === "bonus") {
        bonusAmount = parseFloat(promocode.value);
      }

      // Get user info for double-entry
      const [promoUser] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      // Auto-approved voucher — DB trigger updates ledger_limit.user_balance
      await db.transaction(async (tx) => {
        const [voucher] = await tx.insert(vouchers).values({
          userId: userId,
          type: VoucherType.Bonus,
          method: "promocode",
          reference: promocode.code,
          status: VoucherStatus.Approved,
          addedBy: userId,
          approvedBy: userId,
          approvedDate: new Date().toISOString().split("T")[0],
        }).returning();

        // Row 1: Credit to user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: userId,
          amount: bonusAmount.toString(),
          voucherType: VoucherType.Bonus,
          voucherDetailType: VoucherType.Bonus,
          drCr: DrCr.Credit,
          oppositeUserId: LIMIT_ACCOUNT_ID,
          role: promoUser?.role ?? UserRole.User,
          whitelabelId: promoUser?.whitelabelId,
          description: "bonus voucher - credit to user (promocode: " + promocode.code + ")",
        });

        // Row 2: Debit from limit account
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: LIMIT_ACCOUNT_ID,
          amount: bonusAmount.toString(),
          voucherType: VoucherType.Bonus,
          voucherDetailType: VoucherType.Bonus,
          drCr: DrCr.Debit,
          oppositeUserId: userId,
          role: UserRole.Owner,
          whitelabelId: promoUser?.whitelabelId,
          description: "bonus voucher - debit from limit account (promocode: " + promocode.code + ")",
        });
      });

      await db
        .update(promocodes)
        .set({
          usedCount: increment(promocodes.usedCount, 1),
        })
        .where(eq(promocodes.id, promocode.id));

      set.status = 200;
      return {
        success: true,
        message: "Promocode redeemed successfully",
        data: {
          type: promocode.type,
          value: promocode.value,
          bonusAmount: bonusAmount.toString(),
          spins:
            promocode.type === "free_spins" ? parseFloat(promocode.value) : 0,
        },
      };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
      }),
    }
  )
  .get("/promocodes", async ({ set, db }) => {
    const availablePromocodes = await db
      .select()
      .from(promocodes)
      .where(eq(promocodes.status, "active"))
      .orderBy(desc(promocodes.addedDate));

    set.status = 200;
    return { success: true, data: availablePromocodes };
  })
  // Account ledger statement
  // Returns: opening balance row, transaction rows (date range), closing balance row
  .get("/account-statement", async ({ query, userId, set, db }) => {
    const today    = new Date().toISOString().split("T")[0];
    const fromDate = (query.fromDate as string) || today;
    const toDate   = (query.toDate   as string) || today;

    try {
      const result = await db.execute(sql`
        SELECT
          s.*,
          mr.winner_name,
          mr.runs        AS winner_runs,
          mr.market_type AS result_market_type
        FROM get_user_account_ledger_statement(
          ${userId}::uuid, ${fromDate}::date, ${toDate}::date
        ) s
        LEFT JOIN market_results mr
          ON mr.market_id     = s.market_id
         AND mr.record_status = 0
      `);

      const rows = Array.isArray(result)
        ? result
        : Array.isArray((result as any).rows)
          ? (result as any).rows
          : Array.from(result as any);

      set.status = 200;
      return { success: true, data: { transactions: rows } };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error?.message || "Failed to fetch account statement" };
    }
  })

  // Bet details for a settlement row.
  //   - Per-bet rows come from the SQL function (transactions_declare + market_results).
  //   - Per-bet P&L isn't stored (voucher_details.transaction_id is NULL on settlement,
  //     because settlement aggregates P&L per user per market). So we return per-bet
  //     Won/Lost status derived from winner_id, and the market-level net P&L pulled
  //     from voucher_details joined by voucher_id.
  .get("/account-statement/bet-details", async ({ query, userId, set, db }) => {
    const marketId  = query.marketId  as string;
    const voucherId = (query.voucherId as string) || null;
    if (!marketId) {
      set.status = 400;
      return { success: false, error: "marketId is required" };
    }
    try {
      const betsResult = await db.execute(sql`
        SELECT * FROM get_user_account_ledger_statement_transaction_detail(
          ${userId}::uuid,
          ${marketId}::numeric,
          ${voucherId}::uuid
        )
      `);
      const bets = Array.isArray(betsResult)
        ? betsResult
        : Array.isArray((betsResult as any).rows)
          ? (betsResult as any).rows
          : Array.from(betsResult as any);

      // Market-level net P&L for this voucher (settlement stores aggregated P&L here).
      let marketPnl = 0;
      if (voucherId) {
        const pnlResult = await db.execute(sql`
          SELECT COALESCE(
            SUM(CASE WHEN vd.dr_cr = 1 THEN vd.amount ELSE -vd.amount END),
            0
          ) AS pnl
          FROM voucher_details vd
          WHERE vd.voucher_id     = ${voucherId}::uuid
            AND vd.user_id        = ${userId}::uuid
            AND vd.record_status  = 0
        `);
        const pnlRows = Array.isArray(pnlResult)
          ? pnlResult
          : Array.isArray((pnlResult as any).rows)
            ? (pnlResult as any).rows
            : Array.from(pnlResult as any);
        marketPnl = parseFloat(pnlRows[0]?.pnl ?? 0);
      }

      set.status = 200;
      return { success: true, data: { bets, marketPnl } };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error?.message || "Failed to fetch bet details" };
    }
  })

  .post(
    "/change-password",
    async ({ body, userId, set, db }) => {
      const { currentPassword, newPassword } = body;

      const [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const isCorrectPassword = await comparePassword(
        currentPassword,
        userRecord.password
      );

      if (!isCorrectPassword) {
        set.status = 400;
        return { success: false, message: "Current password is incorrect" };
      }

      const hashedNewPassword = await generateHashPassword(newPassword);

      await db
        .update(users)
        .set({ password: hashedNewPassword })
        .where(eq(users.id, userId));

      set.status = 200;
      return { success: true, message: "Password changed successfully" };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 8 }),
        newPassword: t.String({ minLength: 8 }),
      }),
    }
  );
