import { Elysia, t } from "elysia";
import { users, profiles, otps, whitelabels } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { sendOTP, generateOTP } from "@services/nodemailer";
import { decodeToken, generateTokens } from "@services/token";
import { getCurrentIP } from "@utils/user-ip";
import { comparePassword, generateHashPassword } from "@utils/password";
import { whitelabel_middleware } from "@middleware/whitelabel";
import { cookieConfig } from "@config/cookie";
import { DbType } from "../types";

export const authRoutes = new Elysia({ prefix: "/auth" })
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
  .post(
    "/register",
    async ({ body, db, whitelabel, set }) => {
      const { username, email, password, phone, country, otp, whitelabelId: bodyWhitelabelId, domain: bodyDomain } = body;

      // Verify OTP first
      const [otpRecord] = await db
        .select()
        .from(otps)
        .where(
          and(
            eq(otps.email, email),
            eq(otps.otp, otp),
            eq(otps.used, false),
            eq(otps.type, "email_verification")
          )
        );

      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        set.status = 400;
        return { success: false, message: "Invalid or expired OTP" };
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

      const [user] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          emailVerified: true,
          whitelabelId,
        })
        .returning();

      await db.insert(profiles).values({
        userId: user.id,
        phone,
        country,
      });

      // Mark OTP as used
      await db
        .update(otps)
        .set({ used: true })
        .where(eq(otps.id, otpRecord.id));

      set.status = 201;
      return {
        success: true,
        message: "Registration successful! Please login.",
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String(),
        password: t.String(),
        otp: t.String({ minLength: 6, maxLength: 6 }),
        phone: t.Optional(t.String()),
        country: t.Optional(t.String({ minLength: 2, maxLength: 50 })),
        whitelabelId: t.Optional(t.Union([t.Number(), t.String()])),
        domain: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/login",
    async ({ body, headers, request, set, cookie, db, whitelabel }) => {
      try {

        const { email, password } = body;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));

        if (!user) {
          set.status = 404;
          return { success: false, message: "Account not found" };
        }

        const isCorrectPassword = await comparePassword(password, user.password);
        if (!isCorrectPassword) {
          set.status = 401;
          return { success: false, message: "Invalid credentials" };
        }

        const canLogin = (user.accountStatus ?? true) && (user.parentAccountStatus ?? true);
        if (!canLogin) {
          set.status = 403;
          return { success: false, message: "Account suspended" };
        }

        if (whitelabel && user.role !== "owner") {
          const userWlId = user.whitelabelId != null ? Number(user.whitelabelId) : null;
          const wlId = whitelabel.id != null ? Number(whitelabel.id) : null;
          const isAssignedAdmin = whitelabel.userId != null && Number(whitelabel.userId) === Number(user.id);
          const belongsToWhitelabel = wlId != null && userWlId === wlId;
          if (!belongsToWhitelabel && !isAssignedAdmin) {
            set.status = 403;
            return {
              success: false,
              message: "This account is not valid for this site. Please sign in on the correct domain.",
            };
          }
          if (isAssignedAdmin && !belongsToWhitelabel && wlId != null) {
            await db.update(users).set({ whitelabelId: wlId }).where(eq(users.id, user.id));
          }
        }

        const clientIP = getCurrentIP(headers, request);

        await db
          .update(users)
          .set({ lastLoginIp: clientIP, lastLoginAt: new Date() })
          .where(eq(users.id, user.id));

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(
          user.id,
          user.email,
          user.role || "user"
        );

        // console.log("Login - User role:", user.role);
        // console.log("Login - Generated access token payload:", {
        //   id: user.id,
        //   email: user.email,
        //   role: user.role,
        // });
        // console.log("Login - Cookie config:", cookieConfig);

        // Save tokens in HttpOnly cookies
        cookie.accessToken.set({
          value: accessToken,
          ...cookieConfig.accessToken,
        });

        cookie.refreshToken.set({
          value: refreshToken,
          ...cookieConfig.refreshToken,
        });

        // console.log("Login - Cookies set successfully");

        // Return user info including role/balance for frontend redirect (user → website, admin/super/etc → panel)
        set.status = 200;
        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            membership: user.membership,
            balance: user.balance ?? "0",
            role: user.role ?? "user",
          },
        };
      } catch (e) {
        console.log(e);
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 1 }),
      }),
    }
  )
  .post(
    "/send-otp",
    async ({ body, db, set }) => {
      const { email, type = "password_reset" } = body;

      // For password reset, check if user exists
      if (type === "password_reset") {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));
        if (!user) {
          set.status = 404;
          return { success: false, message: "Email not found" };
        }
      }

      // For registration, check if email is already registered
      if (type === "registration") {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));
        if (existingUser) {
          set.status = 409;
          return { success: false, message: "Email already registered" };
        }
      }

      const otp = generateOTP();
      console.log("otp -> ", otp)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await db.insert(otps).values({
        email,
        otp,
        type: type === "registration" ? "email_verification" : "password_reset",
        expiresAt,
      });

      const res = await sendOTP(email, otp);
      if (!res?.success) {
        set.status = 500;
        return {
          success: false,
          message: "Failed to send OTP",
        };
      }
      set.status = 200;
      return {
        success: true,
        message: "Otp send successfully",
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        type: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/verify-otp",
    async ({ body, set, db }) => {
      const { email, otp } = body;

      const [otpRecord] = await db
        .select()
        .from(otps)
        .where(
          and(eq(otps.email, email), eq(otps.otp, otp), eq(otps.used, false))
        );

      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        set.status = 400;
        return { success: false, message: "Invalid or expired OTP" };
      }

      await db
        .update(otps)
        .set({ used: true })
        .where(eq(otps.id, otpRecord.id));

      await db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.email, email));

      set.status = 200;
      return { success: true, message: "Email verified successfully" };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        otp: t.String({ minLength: 6, maxLength: 6 }),
      }),
    }
  )

  .post("/refresh", async ({ cookie, set, db }) => {
    const refreshToken = cookie.refreshToken?.value as string;

    if (!refreshToken) {
      set.status = 401;
      return { success: false, message: "Refresh token is missing" };
    }

    try {
      const decoded = decodeToken(refreshToken);
      if (!decoded) {
        set.status = 401;
        return { success: false, message: "Invalid refresh token" };
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.id))
        .limit(1);

      if (!user) {
        set.status = 401;
        return { success: false, message: "User not found" };
      }

      const canLogin = (user.accountStatus ?? true) && (user.parentAccountStatus ?? true);
      if (!canLogin) {
        set.status = 403;
        return { success: false, message: "Account suspended" };
      }

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } = generateTokens(
        user.id,
        user.email,
        user.role || "user"
      );

      // Set new tokens in cookies
      cookie.refreshToken.set({
        value: newRefreshToken,
        ...cookieConfig.refreshToken,
      });

      cookie.accessToken.set({
        value: accessToken,
        ...cookieConfig.accessToken,
      });

      set.status = 200;
      return { success: true };
    } catch (error) {
      set.status = 401;
      return { success: false, message: "Invalid refresh token" };
    }
  })
  .post("/logout", async ({ cookie, set }) => {
    // cookie.accessToken.remove();
    // cookie.refreshToken.remove();

    cookie.refreshToken.set({
      value: "",
      ...cookieConfig.refreshToken,
      maxAge: 0,
    });

    cookie.accessToken.set({
      value: "",
      ...cookieConfig.accessToken,
      maxAge: 0,
    });
    set.status = 200;
    return { success: true, message: "Logged out successfully" };
  })
  .post(
    "/reset-password",
    async ({ body, set, db }) => {
      const { email, otp, newPassword } = body;

      const [otpRecord] = await db
        .select()
        .from(otps)
        .where(
          and(eq(otps.email, email), eq(otps.otp, otp), eq(otps.used, false))
        )
        .limit(1);

      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        set.status = 400;
        return { success: false, message: "Invalid or expired OTP" };
      }

      const hashedPassword = await generateHashPassword(newPassword);
      await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.email, email));

      await db
        .update(otps)
        .set({ used: true })
        .where(eq(otps.id, otpRecord.id));

      set.status = 200;
      return { success: true, message: "Password reset successfully" };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        otp: t.String({ minLength: 6, maxLength: 6 }),
        newPassword: t.String({ minLength: 8 }),
      }),
    }
  );
