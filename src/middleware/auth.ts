import jwt from "jsonwebtoken";
import { Cookie } from "elysia";
import { RoleType } from "../types";

interface ElysiaMiddlewareType {
  cookie: Record<string, Cookie<string | undefined | unknown>>;
  allowed?: string[];
}

const secretKey = process.env.JWT_SECRET!;

export const authenticate_jwt = (access_token: string) => {
  try {
    const decoded = jwt.verify(access_token, secretKey);
    return {
      success: true,
      code: 200,
      message: "Valid Access Token",
      data: decoded as { id: number; role: RoleType },
    };
  } catch (err) {
    return {
      success: false,
      code: 401,
      message: "Inalid Access Token",
    };
  }
};

export const app_middleware = ({ cookie, allowed }: ElysiaMiddlewareType) => {
  console.log("=== AUTH MIDDLEWARE DEBUG ===");
  console.log("Raw cookie object:", cookie);
  console.log("Raw allowed parameter:", allowed);
  console.log("Typeof allowed:", typeof allowed);
  console.log("Is allowed array?:", Array.isArray(allowed));

  let access_token = String(cookie.accessToken);

  console.log(
    "Auth middleware - Access token:",
    access_token ? "exists" : "missing"
  );
  console.log("Auth middleware - Allowed roles:", allowed);

  if (!access_token) {
    return {
      success: false,
      code: 404,
      message: "No Access Token in Cookies",
    };
  }

  const middleware_response = authenticate_jwt(access_token);
  console.log("Auth middleware - JWT validation:", middleware_response);

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
    console.log(
      "Auth middleware - Role check failed. User role:",
      middleware_response.data.role,
      "Allowed:",
      allowed
    );
    return {
      success: false,
      code: 403,
      message: "Restricted Endpoint",
    };
  }

  console.log(
    "Auth middleware - Success! User role:",
    middleware_response.data.role
  );
  return {
    success: middleware_response.success,
    code: middleware_response.code,
    message: middleware_response.message,
    data: middleware_response.data,
  };
};
