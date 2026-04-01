const isProduction = process.env.NODE_ENV === "production";

export const cookieConfig = {
  accessToken: {
    httpOnly: false, // Must be false so frontend JS can read and set as first-party cookie
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 15, // 15 minutes
  },
  refreshToken: {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};
