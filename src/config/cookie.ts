const isProduction = process.env.NODE_ENV === "production";

export const cookieConfig = {
  accessToken: {
    httpOnly: true,
    // Only use secure cookies in production (HTTPS). Allow local HTTP during development.
    secure: true,
    sameSite: "none" as const,
    // Don't set domain for cross-origin cookies - let browser handle it
    // domain: '.aiexch.com',
    maxAge: 60 * 15, // 15 minutes
  },
  refreshToken: {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    // Don't set domain for cross-origin cookies - let browser handle it
    // domain: '.aiexch.com',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};
