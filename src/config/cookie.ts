const isProduction = process.env.NODE_ENV === "production";

export const cookieConfig = {
  accessToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("lax" as const) : ("lax" as const),
    domain: isProduction ? ".aiexch.com" : undefined,
    maxAge: 60 * 15, // 15 minutes
  },
  refreshToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("lax" as const) : ("lax" as const),
    domain: isProduction ? ".aiexch.com" : undefined,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};
