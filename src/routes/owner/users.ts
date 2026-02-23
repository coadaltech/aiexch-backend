import { Elysia, t } from "elysia";
import { users, profiles, whitelabels } from "../../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { generateHashPassword, comparePassword } from "../../utils/password";
import { resolveOwnerScope } from "../../utils/ownerScope";
import { computeParentStatuses, cascadeParentStatuses } from "../../utils/userStatusCascade";

export const usersRoutes = new Elysia({ prefix: "/users" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .post(
    "/",
    async ({ body, set, db, whitelabel, store }) => {
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: number; role?: string });
      const requestedRole = (body.role as string) || "user";
      if (!scope.allowedRolesToCreate.includes(requestedRole)) {
        set.status = 403;
        return { success: false, message: `You cannot create users with role "${requestedRole}". Allowed: ${scope.allowedRolesToCreate.join(", ")}` };
      }
      if (scope.scopeWhitelabelId == null && scope.currentUserRole !== "owner") {
        set.status = 403;
        return { success: false, message: "No whitelabel scope. You must operate from your whitelabel domain." };
      }

      const { username, email, password, role, membership, balance, upline, downline, firstName, lastName, phone, country, whitelabelId: bodyWhitelabelId, domain: bodyDomain } = body;
      const createdBy = (store as { id?: number; role?: string })?.id || null;
      let whitelabelId: number | null =
        bodyWhitelabelId != null
          ? Number(bodyWhitelabelId)
          : whitelabel?.id != null
            ? Number(whitelabel.id)
            : null;
      if (whitelabelId == null && bodyDomain && String(bodyDomain).trim()) {
        const [wl] = await db.select({ id: whitelabels.id }).from(whitelabels).where(eq(whitelabels.domain, String(bodyDomain).trim())).limit(1);
        if (wl) whitelabelId = Number(wl.id);
      }
      if (whitelabelId == null && createdBy != null) {
        const [creator] = await db.select({ whitelabelId: users.whitelabelId }).from(users).where(eq(users.id, createdBy)).limit(1);
        if (creator?.whitelabelId != null) whitelabelId = Number(creator.whitelabelId);
        else {
          const [wlByAdmin] = await db.select({ id: whitelabels.id }).from(whitelabels).where(eq(whitelabels.userId, createdBy)).limit(1);
          if (wlByAdmin) whitelabelId = Number(wlByAdmin.id);
        }
      }
      if (scope.currentUserRole !== "owner" && scope.scopeWhitelabelId != null) {
        whitelabelId = scope.scopeWhitelabelId;
      }
      if (scope.currentUserRole === "owner" && scope.scopeWhitelabelId != null) {
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
      if (createdBy != null) {
        const [parent] = await db
          .select({ accountStatus: users.accountStatus, parentAccountStatus: users.parentAccountStatus, betStatus: users.betStatus, parentBetStatus: users.parentBetStatus })
          .from(users)
          .where(eq(users.id, createdBy))
          .limit(1);
        parentAccountStatus = parent
          ? (parent.accountStatus ?? true) && (parent.parentAccountStatus ?? true)
          : true;
        parentBetStatus = parent
          ? (parent.betStatus ?? true) && (parent.parentBetStatus ?? true)
          : true;
      }

      const toStr = (v: string | number | undefined) =>
        v === undefined ? "0.00" : typeof v === "number" ? v.toString() : v;
      const [user] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          role: role || "user",
          membership: membership || "bronze",
          accountStatus: true,
          betStatus: true,
          parentAccountStatus,
          parentBetStatus,
          balance: balance || "0",
          upline: toStr(upline),
          downline: toStr(downline),
          emailVerified: true,
          whitelabelId,
          createdBy: createdBy,
        })
        .returning();

      // Create profile if personal info provided
      if (firstName || lastName || phone || country) {
        await db.insert(profiles).values({
          userId: user.id,
          firstName,
          lastName,
          phone,
          country,
        });
      }

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
        balance: t.Optional(t.String()),
        upline: t.Optional(t.Union([t.String(), t.Number()])),
        downline: t.Optional(t.Union([t.String(), t.Number()])),
        whitelabelId: t.Optional(t.Union([t.Number(), t.String()])),
        domain: t.Optional(t.String()),
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        country: t.Optional(t.String()),
      }),
    }
  )
  .get("/", async ({ set, db, whitelabel, store }) => {
    const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: number; role?: string });
    const isOwnerNoScope = scope.currentUserRole === "owner" && scope.scopeWhitelabelId == null;
    let visibleUsers: { id: number; username: string; email: string; [k: string]: unknown }[];
    if (isOwnerNoScope) {
      visibleUsers = await db.select().from(users);
    } else if (scope.scopeWhitelabelId == null) {
      set.status = 200;
      return { success: true, data: [] };
    } else {
      const conditions = [eq(users.whitelabelId, scope.scopeWhitelabelId)];
      if (scope.filterUsersByCreatedBy) {
        conditions.push(eq(users.createdBy, scope.currentUserId));
      }
      visibleUsers = await db.select().from(users).where(and(...conditions));
    }
    const creatorIds = [...new Set(visibleUsers.map((u) => u.createdBy).filter((id): id is number => id != null))];
    const whitelabelIds = [...new Set(visibleUsers.map((u) => u.whitelabelId).filter((id): id is number => id != null))];
    const creators =
      creatorIds.length > 0
        ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, creatorIds))
        : [];
    const wls =
      whitelabelIds.length > 0
        ? await db.select({ id: whitelabels.id, name: whitelabels.name }).from(whitelabels).where(inArray(whitelabels.id, whitelabelIds))
        : [];
    const creatorMap = new Map(creators.map((c) => [c.id, c.username]));
    const wlMap = new Map(wls.map((w) => [w.id, w.name]));

    const usersWithProfiles = [];
    for (const user of visibleUsers) {
      const profile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, user.id))
        .limit(1);
      usersWithProfiles.push({
        ...user,
        firstName: profile[0]?.firstName || null,
        lastName: profile[0]?.lastName || null,
        phone: profile[0]?.phone || null,
        country: profile[0]?.country || null,
        createdByUsername: user.createdBy != null ? (creatorMap.get(Number(user.createdBy)) ?? null) : null,
        whitelabelName: user.whitelabelId != null ? (wlMap.get(Number(user.whitelabelId)) ?? null) : null,
      });
    }
    set.status = 200;
    return { success: true, data: usersWithProfiles };
  })

  .put(
    "/:id",
    async ({ params, set, body, db, whitelabel, store }) => {
      const userId = parseInt(params.id);
      if (isNaN(userId) || userId <= 0) {
        set.status = 400;
        return { success: false, message: "Invalid user ID" };
      }
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: number; role?: string });
      const [target] = await db
        .select({
          id: users.id,
          whitelabelId: users.whitelabelId,
          createdBy: users.createdBy,
          accountStatus: users.accountStatus,
          betStatus: users.betStatus,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.scopeWhitelabelId != null && target.whitelabelId !== scope.scopeWhitelabelId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.filterUsersByCreatedBy && target.createdBy !== scope.currentUserId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const isCreator = target.createdBy === (store as { id?: number }).id;
      const isChangingStatus =
        isCreator &&
        (body.accountStatus !== undefined || body.betStatus !== undefined);
      if (isChangingStatus) {
        const currentUserPassword = body.currentUserPassword ?? body.password;
        if (!currentUserPassword || typeof currentUserPassword !== "string") {
          set.status = 401;
          return { success: false, message: "Transaction password is required to change status" };
        }
        const currentUserId = Number((store as { id?: number }).id);
        if (!Number.isFinite(currentUserId)) {
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

      const updateData: Record<string, unknown> = { ...body };
      delete updateData.currentUserPassword;
      delete updateData.status;
      if (isChangingStatus) delete updateData.password;
      else if (body.password) updateData.password = await generateHashPassword(body.password);
      if (body.upline !== undefined) {
        updateData.upline = typeof body.upline === "number" ? body.upline.toString() : body.upline;
      }
      if (body.downline !== undefined) {
        updateData.downline = typeof body.downline === "number" ? body.downline.toString() : body.downline;
      }
      if (!isCreator && (body.accountStatus !== undefined || body.betStatus !== undefined)) {
        set.status = 403;
        return { success: false, message: "Only the user's creator can change their status" };
      }
      if (!isCreator) {
        delete updateData.accountStatus;
        delete updateData.betStatus;
      }

      const [updated] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const statusChanged =
        (body.accountStatus !== undefined && body.accountStatus !== target.accountStatus) ||
        (body.betStatus !== undefined && body.betStatus !== target.betStatus);
      if (isCreator && statusChanged) {
        await cascadeParentStatuses(db, userId);
      }

      set.status = 200;
      return { success: true, data: updated };
    },
    {
      params: t.Object({
        id: t.String({ pattern: "^[1-9]\\d*$" }),
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
        balance: t.Optional(t.String()),
        upline: t.Optional(t.Union([t.String(), t.Number()])),
        downline: t.Optional(t.Union([t.String(), t.Number()])),
        password: t.Optional(t.String({ minLength: 6 })),
      }),
    }
  )

  .put(
    "/:id/profile",
    async ({ params, body, set, db, whitelabel, store }) => {
      const userId = parseInt(params.id);
      const scope = await resolveOwnerScope(db, whitelabel ?? undefined, store as { id?: number; role?: string });
      const [target] = await db.select({ id: users.id, whitelabelId: users.whitelabelId, createdBy: users.createdBy }).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.scopeWhitelabelId != null && target.whitelabelId !== scope.scopeWhitelabelId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      if (scope.filterUsersByCreatedBy && target.createdBy !== scope.currentUserId) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      const existingProfile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

      if (existingProfile.length > 0) {
        const [updated] = await db
          .update(profiles)
          .set(body)
          .where(eq(profiles.userId, userId))
          .returning();
        set.status = 200;
        return { success: true, data: updated };
      } else {
        const [created] = await db
          .insert(profiles)
          .values({ userId, ...body })
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
