import { Elysia, t } from "elysia";
import { users, profiles } from "../../db/schema";
import { eq } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { generateHashPassword } from "../../utils/password";

export const usersRoutes = new Elysia({ prefix: "/users" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .post(
    "/",
    async ({ body, set, db, store }) => {
      const { username, email, password, role, membership, status, balance, firstName, lastName, phone, country } = body;
      const createdBy = (store as { id?: number; role?: string })?.id || null; // Get current user ID from store

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

      const [user] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          role: role || "user",
          membership: membership || "bronze",
          status: status || "active",
          balance: balance || "0",
          emailVerified: true,
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
        status: t.Optional(t.Union([
          t.Literal("active"),
          t.Literal("inactive"),
          t.Literal("suspended"),
        ])),
        balance: t.Optional(t.String()),
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        country: t.Optional(t.String()),
      }),
    }
  )
  .get("/", async ({ set, db }) => {
    const allUsers = await db.select().from(users);
    const usersWithProfiles = [];

    for (const user of allUsers) {
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
      });
    }

    set.status = 200;
    return { success: true, data: usersWithProfiles };
  })

  .put(
    "/:id",
    async ({ params, set, body, db }) => {
      const userId = parseInt(params.id);
      if (isNaN(userId) || userId <= 0) {
        set.status = 400;
        return { success: false, message: "Invalid user ID" };
      }

      const updateData = { ...body };
      if (body.password) {
        updateData.password = await generateHashPassword(body.password);
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
        status: t.Optional(
          t.Union([
            t.Literal("active"),
            t.Literal("inactive"),
            t.Literal("suspended"),
          ])
        ),
        balance: t.Optional(t.String()),
        password: t.Optional(t.String({ minLength: 6 })),
      }),
    }
  )

  .put(
    "/:id/profile",
    async ({ params, body, set, db }) => {
      const userId = parseInt(params.id);
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
