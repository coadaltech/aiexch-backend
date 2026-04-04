const isProduction = process.env.NODE_ENV === "production";

export const cookieConfig = {
  accessToken: {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    // No maxAge → session cookie → cleared when browser closes
  },
  refreshToken: {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    // No maxAge → session cookie → cleared when browser closes
  },
};
