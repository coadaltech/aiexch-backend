import { Elysia, t } from "elysia";
import {
  accountStatements,
  notifications,
  profiles,
  promocodes,
  vouchers,
  voucherDetails,
  userReadNotifications,
  users,
  ledgerLimit,
} from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { increment } from "../utils/numbers";
import { uploadFile } from "../services/s3";
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
  .state({ id: "", role: 0 as number })
  .guard({
    beforeHandle({ cookie, set, store }) {
      const state_result = app_middleware({ cookie });

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
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

  .get("/me", async ({ store, set, db }) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, store.id))
      .limit(1);

    const canLogin = (user?.accountStatus ?? true) && (user?.parentAccountStatus ?? true);
    if (!user || !canLogin) {
      set.status = 401;
      return { loggedIn: false };
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, store.id))
      .limit(1);

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
      },
    };
  })
  .get("/", async ({ store, set, db }) => {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, store.id))
      .limit(1);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, store.id))
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

  .get("/balance", async ({ store, set, db }) => {
    const [ledger] = await db
      .select({ finalLimit: ledgerLimit.finalLimit })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, store.id))
      .limit(1);

    set.status = 200;
    return {
      success: true,
      balance: ledger?.finalLimit || "0",
    };
  })

  .put(
    "/",
    async ({ body, store, set, db }) => {
      const [existingProfile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, store.id))
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
            userId: store.id,
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
          .where(eq(profiles.userId, store.id))
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

  // Get user transactions (queries vouchers table but endpoint name remains "transactions" for user-facing API)
  .get("/transactions", async ({ query, store, set, db }) => {
    const { vouchers } = await import("../db/schema");

    let whereConditions = [eq(vouchers.userId, store.id)];

    if (query.type && query.type !== "all") {
      whereConditions.push(eq(vouchers.type, parseVoucherType(query.type)));
    }

    const queryBuilder = db
      .select()
      .from(vouchers)
      .where(and(...whereConditions));

    const userTransactions = await queryBuilder.orderBy(vouchers.addedDate);
    const mapped = userTransactions.map((v) => ({
      ...v,
      type: voucherTypeToString(v.type),
      status: voucherStatusToString(v.status),
    }));
    set.status = 200;
    return { success: true, data: mapped };
  })

  // Get user bet history
  .get("/bets", async ({ store, query, set, db }) => {
    const { bets } = await import("../db/schema");

    let whereConditions = [eq(bets.userId, store.id)];

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
  .get("/bet-history", async ({ store, query, set, db }) => {
    try {
      const { bets } = await import("../db/schema");

      let whereConditions = [eq(bets.userId, store.id)];

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

  // Get user account statements
  .get("/statements", async ({ query, store, set, db }) => {
    const whereConditions = [eq(accountStatements.userId, store.id)];
    if (query.period) {
      whereConditions.push(eq(accountStatements.period, query.period));
    }

    const statements = await db
      .select()
      .from(accountStatements)
      .where(and(...whereConditions))
      .orderBy(accountStatements.generatedAt);

    set.status = 200;
    return { success: true, data: statements };
  })

  // Create deposit transaction (pending — admin must approve, trigger updates ledger)
  .post(
    "/deposit",
    async ({ body, store, set, db }) => {
      let proofImageUrl: string | undefined;
      if (body.proofImage) {
        proofImageUrl = await uploadFile(body.proofImage);
      }

      // Get user info for double-entry
      const [user] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: store.id,
            type: VoucherType.Deposit,
            status: VoucherStatus.Pending,
            method: body.method,
            reference: body.reference,
            addedBy: store.id,
          })
          .returning();

        // Row 1: Credit to user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: store.id,
          amount: body.amount,
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
          drCr: DrCr.Debit,
          oppositeUserId: store.id,
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
    async ({ body, store, set, db }) => {
      const amount = parseFloat(body.amount);

      // Check cash balance in ledger_limit
      const [ledger] = await db
        .select({ userBalance: ledgerLimit.userBalance })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, store.id))
        .limit(1);

      if (!ledger || parseFloat(ledger.userBalance || "0") < amount) {
        set.status = 400;
        return { success: false, message: "Insufficient balance" };
      }

      // Get user info for double-entry
      const [user] = await db
        .select({ groupId: users.groupId, role: users.role, whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      const result = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            userId: store.id,
            type: VoucherType.Withdraw,
            status: VoucherStatus.Pending,
            method: body.method,
            reference: body.address,
            addedBy: store.id,
          })
          .returning();

        // Row 1: Debit from user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: store.id,
          amount: body.amount,
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
          drCr: DrCr.Credit,
          oppositeUserId: store.id,
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
    async ({ body, store, set, db }) => {
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
            eq(vouchers.userId, store.id),
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
        .where(eq(ledgerLimit.userId, store.id))
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
        .where(eq(users.id, store.id))
        .limit(1);

      const LIMIT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000003";

      // Auto-approved voucher — DB trigger updates ledger_limit.user_balance
      await db.transaction(async (tx) => {
        const [voucher] = await tx.insert(vouchers).values({
          userId: store.id,
          type: VoucherType.Bonus,
          method: "promocode",
          reference: promocode.code,
          status: VoucherStatus.Approved,
          addedBy: store.id,
          approvedBy: store.id,
          approvedDate: new Date().toISOString().split("T")[0],
        }).returning();

        // Row 1: Credit to user
        await tx.insert(voucherDetails).values({
          voucherId: voucher.id,
          userId: store.id,
          amount: bonusAmount.toString(),
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
          drCr: DrCr.Debit,
          oppositeUserId: store.id,
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
  .post(
    "/change-password",
    async ({ body, store, set, db }) => {
      const { currentPassword, newPassword } = body;

      const [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.id, store.id))
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
        .where(eq(users.id, store.id));

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
