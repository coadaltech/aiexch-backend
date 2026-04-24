import { Elysia, t } from "elysia";
import { users, profiles, whitelabels, ledgerLimit, SYSTEM_USER_ID } from "../../db/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { generateHashPassword, comparePassword } from "../../utils/password";
import { resolveOwnerScope, getGroupIdForRole } from "../../utils/ownerScope";
import { computeParentStatuses, cascadeParentStatuses } from "../../utils/userStatusCascade";
import { UserRole, MembershipType, parseUserRole, parseMembership, membershipToString } from "../../types/enums";

export const usersRoutes = new Elysia({ prefix: "/users" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .post(
    "/",
    async ({ body, set, db, whitelabel, store }) => {
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: string; role?: string });
      const requestedRole = body.role ? parseUserRole(body.role as string) : UserRole.User;
      if (!scope.allowedRolesToCreate.includes(requestedRole)) {
        set.status = 403;
        return { success: false, message: `You cannot create users with role "${requestedRole}". Allowed: ${scope.allowedRolesToCreate.join(", ")}` };
      }
      if (scope.scopeWhitelabelId == null && scope.currentUserRole !== UserRole.Owner) {
        set.status = 403;
        return { success: false, message: "No whitelabel scope. You must operate from your whitelabel domain." };
      }

      const { username, email, password, role, membership, upline, downline, firstName, lastName, phone, country, whitelabelId: bodyWhitelabelId, domain: bodyDomain, currencyId } = body as any;
      const addedBy = (store as { id?: string; role?: string })?.id;
      let whitelabelId: string | null =
        bodyWhitelabelId != null
          ? String(bodyWhitelabelId)
          : whitelabel?.id ?? null;
      if (whitelabelId == null && bodyDomain && String(bodyDomain).trim()) {
        const [wl] = await db.select({ id: whitelabels.id }).from(whitelabels).where(eq(whitelabels.domain, String(bodyDomain).trim())).limit(1);
        if (wl) whitelabelId = wl.id;
      }
      if (whitelabelId == null && addedBy != null) {
        const [creator] = await db.select({ whitelabelId: users.whitelabelId }).from(users).where(eq(users.id, addedBy)).limit(1);
        if (creator?.whitelabelId != null) whitelabelId = creator.whitelabelId;
        else {
          const [wlByAdmin] = await db.select({ id: whitelabels.id }).from(whitelabels).where(eq(whitelabels.userId, addedBy)).limit(1);
          if (wlByAdmin) whitelabelId = wlByAdmin.id;
        }
      }
      if (scope.currentUserRole !== UserRole.Owner && scope.scopeWhitelabelId != null) {
        whitelabelId = scope.scopeWhitelabelId;
      }
      if (scope.currentUserRole === UserRole.Owner && scope.scopeWhitelabelId != null) {
        whitelabelId = scope.scopeWhitelabelId;
      }

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email));
      if (existingUser.length > 0) {
        set.status = 409;
        return { success: false, message: "Email already registered" };
      }

      const existingUsername = await db
        .select()
        .from(users)
        .where(eq(users.username, username));
      if (existingUsername.length > 0) {
        set.status = 409;
        return { success: false, message: "Username already taken" };
      }

      const hashedPassword = await generateHashPassword(password);

      let parentAccountStatus = true;
      let parentBetStatus = true;
      if (addedBy != null) {
        const [parent] = await db
          .select({ accountStatus: users.accountStatus, parentAccountStatus: users.parentAccountStatus })
          .from(users)
          .where(eq(users.id, addedBy))
          .limit(1);
        const [parentProfile] = await db
          .select({ betStatus: profiles.betStatus, parentBetStatus: profiles.parentBetStatus })
          .from(profiles)
          .where(eq(profiles.userId, addedBy))
          .limit(1);
        parentAccountStatus = parent
          ? (parent.accountStatus ?? true) && (parent.parentAccountStatus ?? true)
          : true;
        parentBetStatus = parentProfile
          ? (parentProfile.betStatus ?? true) && (parentProfile.parentBetStatus ?? true)
          : true;
      }

      const toStr = (v: string | number | undefined) =>
        v === undefined ? "0.00" : typeof v === "number" ? v.toString() : v;
      const finalRole = requestedRole;
      const [user] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          role: finalRole,
          accountStatus: true,
          parentAccountStatus,
          emailVerified: true,
          whitelabelId,
          createdBy: addedBy || null,
          addedBy: addedBy,
          groupId: finalRole,
        })
        .returning();

      await db.insert(profiles).values({
        userId: user.id,
        membership: membership ? parseMembership(membership) : MembershipType.Bronze,
        betStatus: true,
        parentBetStatus,
        upline: toStr(upline),
        downline: toStr(downline),
        currencyId: currencyId || null,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        country: country || null,
        addedBy: addedBy || SYSTEM_USER_ID,
        updateBy: addedBy || SYSTEM_USER_ID,
      });

      // Create ledger_limit record — all amounts start at 0;
      // admin can assign a credit limit (userLimit) separately.
      await db.insert(ledgerLimit).values({
        userId: user.id,
        userBalance: "0",
        userLimit: "0",
        limitConsumed: "0",
        fixLimit: "0",
        finalLimit: "0",
        addedBy: addedBy || SYSTEM_USER_ID,
        updateBy: addedBy || SYSTEM_USER_ID,
      });

      set.status = 201;
      return {
        success: true,
        data: user,
        message: "User created successfully",
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6 }),
        role: t.Optional(t.Union([
          t.Literal("owner"),
          t.Literal("admin"),
          t.Literal("super"),
          t.Literal("master"),
          t.Literal("agent"),
          t.Literal("user"),
        ])),
        membership: t.Optional(t.Union([
          t.Literal("bronze"),
          t.Literal("silver"),
          t.Literal("gold"),
          t.Literal("platinum"),
        ])),
        upline: t.Optional(t.Union([t.String(), t.Number()])),
        downline: t.Optional(t.Union([t.String(), t.Number()])),
        whitelabelId: t.Optional(t.Union([t.Number(), t.String()])),
        domain: t.Optional(t.String()),
        currencyId: t.Optional(t.String()),
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        country: t.Optional(t.String()),
      }),
    }
  )
  .get("/", async ({ set, db, whitelabel, store }) => {
    // Scope resolution stays in TS — it reads headers, cookies, and the
    // whitelabel middleware result. The SQL function applies the actual
    // visibility rules and enrichment joins in one query.
    const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: string; role?: string });

    // Early-exit for non-owner callers without a whitelabel scope, same as
    // the old logic (these users have no business seeing anyone).
    if (scope.currentUserRole !== UserRole.Owner && scope.scopeWhitelabelId == null) {
      set.status = 200;
      return { success: true, data: [] };
    }

    const rows = await db.execute(sql`
      SELECT fn_list_owner_users(
        ${scope.currentUserId}::uuid,
        ${scope.currentUserRole}::int,
        ${scope.scopeWhitelabelId ?? null}::uuid
      ) AS data
    `);

    const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    const data: any[] = (rowArray[0]?.data as any[] | null) ?? [];

    set.status = 200;
    return { success: true, data };
  })

  .get("/:id/created-users", async ({ params, set, db, whitelabel, store }) => {
    const targetUserId = params.id;
    if (!targetUserId || typeof targetUserId !== "string") {
      set.status = 400;
      return { success: false, message: "Invalid user ID" };
    }
    const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: string; role?: string });

    // Verify the target user exists and is visible to the requester
    const [target] = await db
      .select({ id: users.id, whitelabelId: users.whitelabelId, addedBy: users.addedBy })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) {
      set.status = 404;
      return { success: false, message: "User not found" };
    }
    if (scope.scopeWhitelabelId != null && target.whitelabelId !== scope.scopeWhitelabelId) {
      set.status = 404;
      return { success: false, message: "User not found" };
    }

    // Get all users created by the target user
    const createdUsers = await db.select().from(users).where(eq(users.createdBy, targetUserId));

    const userIds = createdUsers.map((u) => u.id);
    const ledgerRows =
      userIds.length > 0
        ? await db.select().from(ledgerLimit).where(inArray(ledgerLimit.userId, userIds))
        : [];
    const ledgerMap = new Map(ledgerRows.map((l) => [l.userId, l]));

    const result = [];
    for (const user of createdUsers) {
      const [profile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, user.id))
        .limit(1);
      const ledger = ledgerMap.get(user.id);
      result.push({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        groupId: user.groupId,
        accountStatus: user.accountStatus,
        parentAccountStatus: user.parentAccountStatus,
        membership: profile?.membership ?? MembershipType.Bronze,
        betStatus: profile?.betStatus ?? true,
        parentBetStatus: profile?.parentBetStatus ?? true,
        balance: ledger?.userBalance ?? "0.00",
        fixLimit: ledger?.fixLimit ?? "0.00",
        finalLimit: ledger?.finalLimit ?? "0.00",
        firstName: profile?.firstName || null,
        lastName: profile?.lastName || null,
        phone: profile?.phone || null,
        lastLoginAt: profile?.lastLoginAt ?? null,
        addedDate: user.addedDate,
      });
    }
    set.status = 200;
    return { success: true, data: result };
  }, {
    params: t.Object({ id: t.String() }),
  })

  .get("/:id/ledger", async ({ params, set, db }) => {
    const [ledger] = await db
      .select({
        fixLimit: ledgerLimit.fixLimit,
        finalLimit: ledgerLimit.finalLimit,
        userLimit: ledgerLimit.userLimit,
        limitConsumed: ledgerLimit.limitConsumed,
        userBalance: ledgerLimit.userBalance,
      })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, params.id));
    if (!ledger) {
      set.status = 404;
      return { success: false, message: "Ledger not found" };
    }
    set.status = 200;
    return { success: true, data: ledger };
  }, {
    params: t.Object({ id: t.String() }),
  })

  .put(
    "/:id",
    async ({ params, set, body, db, whitelabel, store }) => {
      const userId = params.id;
      if (!userId || typeof userId !== "string") {
        set.status = 400;
        return { success: false, message: "Invalid user ID" };
      }
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: string; role?: string });
      const [target] = await db
        .select({
          id: users.id,
          whitelabelId: users.whitelabelId,
          addedBy: users.addedBy,
          createdBy: users.createdBy,
          accountStatus: users.accountStatus,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      const [targetProfile] = await db
        .select({ betStatus: profiles.betStatus })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

      if (scope.scopeWhitelabelId != null && target.whitelabelId !== scope.scopeWhitelabelId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.filterUsersByCreatedBy && (target.createdBy ?? target.addedBy) !== scope.currentUserId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const isCreator = (target.createdBy ?? target.addedBy) === (store as { id?: string }).id;
      const isChangingStatus =
        isCreator &&
        (body.accountStatus !== undefined || body.betStatus !== undefined);
      if (isChangingStatus) {
        const currentUserPassword = body.currentUserPassword ?? body.password;
        if (!currentUserPassword || typeof currentUserPassword !== "string") {
          set.status = 401;
          return { success: false, message: "Transaction password is required to change status" };
        }
        const currentUserId = (store as { id?: string }).id;
        if (!currentUserId) {
          set.status = 401;
          return { success: false, message: "Unauthorized" };
        }
        const [currentUserRow] = await db
          .select({ password: users.password })
          .from(users)
          .where(eq(users.id, currentUserId))
          .limit(1);
        if (!currentUserRow?.password) {
          set.status = 401;
          return { success: false, message: "User not found" };
        }
        const passwordValid = await comparePassword(currentUserPassword, currentUserRow.password);
        if (!passwordValid) {
          set.status = 401;
          return { success: false, message: "Incorrect password" };
        }
      }

      if (!isCreator && (body.accountStatus !== undefined || body.betStatus !== undefined)) {
        set.status = 403;
        return { success: false, message: "Only the user's creator can change their status" };
      }

      const updatedBy = (store as { id?: string })?.id || SYSTEM_USER_ID;
      const userUpdateData: Record<string, unknown> = { updateBy: updatedBy };
      const profileUpdateData: Record<string, unknown> = { updateBy: updatedBy };

      if (body.role !== undefined) {
        const newRole = parseUserRole(body.role);
        userUpdateData.role = newRole;
        userUpdateData.groupId = newRole;
      }
      if (body.accountStatus !== undefined && isCreator) userUpdateData.accountStatus = body.accountStatus;
      if (body.password && !isChangingStatus) userUpdateData.password = await generateHashPassword(body.password);

      if (body.membership !== undefined) profileUpdateData.membership = parseMembership(body.membership);
      if (body.betStatus !== undefined && isCreator) profileUpdateData.betStatus = body.betStatus;
      if (body.upline !== undefined) profileUpdateData.upline = typeof body.upline === "number" ? body.upline.toString() : body.upline;
      if (body.downline !== undefined) profileUpdateData.downline = typeof body.downline === "number" ? body.downline.toString() : body.downline;
      if (body.currencyId !== undefined) profileUpdateData.currencyId = body.currencyId;

      let updated: any = null;
      if (Object.keys(userUpdateData).length > 0) {
        const [u] = await db
          .update(users)
          .set(userUpdateData)
          .where(eq(users.id, userId))
          .returning();
        updated = u;
      }
      if (Object.keys(profileUpdateData).length > 0) {
        const existingProfile = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
        if (existingProfile.length > 0) {
          await db.update(profiles).set(profileUpdateData).where(eq(profiles.userId, userId));
        } else {
          await db.insert(profiles).values({ userId, ...profileUpdateData });
        }
      }

      if (!updated) {
        const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        updated = u;
      }
      if (!updated) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const statusChanged =
        (body.accountStatus !== undefined && body.accountStatus !== target.accountStatus) ||
        (body.betStatus !== undefined && body.betStatus !== (targetProfile?.betStatus ?? true));
      if (isCreator && statusChanged) {
        await cascadeParentStatuses(db, userId);
      }

      const [updatedProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
      set.status = 200;
      return { success: true, data: { ...updated, ...updatedProfile } };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        role: t.Optional(t.Union([
          t.Literal("owner"),
          t.Literal("admin"),
          t.Literal("super"),
          t.Literal("master"),
          t.Literal("agent"),
          t.Literal("user"),
        ])),
        membership: t.Optional(
          t.Union([
            t.Literal("bronze"),
            t.Literal("silver"),
            t.Literal("gold"),
            t.Literal("platinum"),
          ])
        ),
        accountStatus: t.Optional(t.Boolean()),
        betStatus: t.Optional(t.Boolean()),
        currentUserPassword: t.Optional(t.String()),
        upline: t.Optional(t.Union([t.String(), t.Number()])),
        downline: t.Optional(t.Union([t.String(), t.Number()])),
        password: t.Optional(t.String({ minLength: 6 })),
        currencyId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  )

  .put(
    "/:id/profile",
    async ({ params, body, set, db, whitelabel, store }) => {
      const userId = params.id;
      if (!userId) {
        set.status = 400;
        return { success: false, message: "Invalid user ID" };
      }
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: string; role?: string });
      const [target] = await db.select({ id: users.id, whitelabelId: users.whitelabelId, addedBy: users.addedBy, createdBy: users.createdBy }).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.scopeWhitelabelId != null && target.whitelabelId !== scope.scopeWhitelabelId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.filterUsersByCreatedBy && (target.createdBy ?? target.addedBy) !== scope.currentUserId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const existingProfile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

      const currentUserId = (store as { id?: string })?.id || SYSTEM_USER_ID;
      if (existingProfile.length > 0) {
        const [updated] = await db
          .update(profiles)
          .set({ ...body, updateBy: currentUserId })
          .where(eq(profiles.userId, userId))
          .returning();
        set.status = 200;
        return { success: true, data: updated };
      } else {
        const [created] = await db
          .insert(profiles)
          .values({ userId, ...body, addedBy: currentUserId, updateBy: currentUserId })
          .returning();
        set.status = 201;
        return { success: true, data: created };
      }
    },
    {
      body: t.Object({
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        country: t.Optional(t.String()),
      }),
    }
  );
