import jwt from "jsonwebtoken";
import { Cookie } from "elysia";
import { RoleType } from "../types";
import { db } from "@db/index";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { decodeToken } from "@services/token";

interface ElysiaMiddlewareType {
  cookie: Record<string, Cookie<string | undefined | unknown>>;
  headers?: Record<string, string | undefined>;
  allowed?: number[];
}

const secretKey = process.env.JWT_SECRET!;

export const authenticate_jwt = (access_token: string) => {
  try {
    const decoded = jwt.verify(access_token, secretKey);
    return {
      success: true,
      code: 200,
      message: "Valid Access Token",
      data: decoded as { id: string; role: RoleType; sessionToken?: string },
    };
  } catch (err) {
    return {
      success: false,
      code: 401,
      message: "Inalid Access Token",
    };
  }
};

export const app_middleware = async ({ cookie, headers, allowed }: ElysiaMiddlewareType) => {
  // Prefer Authorization header (works cross-domain on Safari), fall back to cookie
  const authHeader = headers?.authorization;
  const tokenFromHeader = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const tokenFromCookie = String(cookie.accessToken ?? "");
  const access_token = tokenFromHeader || tokenFromCookie;

  if (!access_token) {
    return {
      success: false,
      code: 404,
      message: "No Access Token in Cookies",
    };
  }

  const middleware_response = authenticate_jwt(access_token);

  if (
    !middleware_response.success ||
    (!middleware_response.data?.id && !middleware_response.data?.role)
  ) {
    return {
      success: middleware_response.success,
      code: middleware_response.code,
      message: middleware_response.message,
    };
  }

  if (allowed && !allowed.includes(middleware_response.data.role)) {
    return {
      success: false,
      code: 403,
      message: "Restricted Endpoint",
    };
  }

  // ── Session token validation ──────────────────────────────────────────────
  // Decode the token to get the sessionToken embedded at login time, then
  // compare it against the value stored in the DB.  If they differ, the user
  // has logged in on another device/tab and this session is now invalid.
  const decoded = decodeToken(access_token);
  if (decoded?.sessionToken) {
    try {
      const [userRecord] = await db
        .select({ sessionToken: users.sessionToken })
        .from(users)
        .where(eq(users.id, middleware_response.data.id))
        .limit(1);

      if (userRecord?.sessionToken && userRecord.sessionToken !== decoded.sessionToken) {
        return {
          success: false,
          code: 401,
          message: "Session expired. You have been logged in on another device.",
        };
      }
    } catch {
      // DB lookup failure — don't block the request, let it through
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return {
    success: middleware_response.success,
    code: middleware_response.code,
    message: middleware_response.message,
    data: middleware_response.data,
  };
};
