import jwt from "jsonwebtoken";
import { Cookie } from "elysia";
import { RoleType } from "../types";
import { db } from "@db/index";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { decodeToken } from "@services/token";
import { verifyDpopProof } from "@services/dpop";

interface ElysiaMiddlewareType {
  cookie: Record<string, Cookie<string | undefined | unknown>>;
  headers?: Record<string, string | undefined>;
  allowed?: number[];
  /**
   * The raw request — required to enforce DPoP (we need the method + path + the
   * `DPoP` proof header). When a token is key-bound (cnf.jkt) but no request is
   * supplied, the call fails closed.
   */
  request?: Request;
}

const secretKey = process.env.JWT_SECRET!;

export const authenticate_jwt = (access_token: string) => {
  try {
    const decoded = jwt.verify(access_token, secretKey);
    return {
      success: true,
      code: 200,
      message: "Valid Access Token",
      data: decoded as {
        id: string;
        role: RoleType;
        sessionToken?: string;
        cnf?: { jkt?: string };
      },
    };
  } catch (err) {
    return {
      success: false,
      code: 401,
      message: "Inalid Access Token",
    };
  }
};

export const app_middleware = async ({ cookie, headers, allowed, request }: ElysiaMiddlewareType) => {
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

  // ── DPoP (sender-constrained tokens) ──────────────────────────────────────
  // If the access token is key-bound (carries cnf.jkt), require a valid DPoP
  // proof for THIS request, signed by the matching key. A stolen token alone is
  // then useless — the thief can't produce a proof without the private key.
  // Tokens without cnf (legacy / pre-DPoP clients) skip this, so rollout is
  // backward compatible.
  const boundJkt = middleware_response.data.cnf?.jkt;
  if (boundJkt) {
    if (!request) {
      // A bound token reached a route that didn't forward the request — never
      // accept it unverified.
      return { success: false, code: 401, message: "DPoP verification unavailable" };
    }
    const proof = request.headers.get("dpop") ?? undefined;
    const path = new URL(request.url).pathname;
    const dpop = await verifyDpopProof(proof, request.method, path);
    if (!dpop.ok || dpop.jkt !== boundJkt) {
      return { success: false, code: 401, message: "Invalid or missing DPoP proof" };
    }
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
