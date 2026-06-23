import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET!;
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

export function generateAccessToken(payload: any) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(payload: any) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function generateTokens(
  id: string,
  email: string | null,
  role: number,
  sessionToken: string,
  refreshJti?: string,
  /** DPoP key thumbprint (jkt) — binds the tokens to the client's key pair. */
  jkt?: string,
) {
  const base = { id, email, role, sessionToken };

  // When a DPoP key is bound, the access token carries the standard `cnf.jkt`
  // confirmation claim; the middleware then requires a matching proof on every
  // request. Without it (legacy clients) the token stays a plain bearer token.
  const accessToken = generateAccessToken(jkt ? { ...base, cnf: { jkt } } : base);

  // The refresh token additionally carries a unique id (jti) — the server stores
  // the live jti per user and rotates it on every refresh; replaying a spent jti
  // is detected as theft. It also carries `jkt` so refresh can re-bind the new
  // access token (and stay sender-constrained) without the client re-sending the
  // public key.
  const refreshToken = generateRefreshToken({
    ...base,
    ...(refreshJti ? { jti: refreshJti } : {}),
    ...(jkt ? { jkt } : {}),
  });

  return { accessToken, refreshToken };
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export function decodeToken(token: string) {
  try {
    return jwt.decode(token) as {
      id: string;
      role: number;
      sessionToken?: string;
      jti?: string;
      jkt?: string;
      cnf?: { jkt?: string };
    };
  } catch (error) {
    return null;
  }
}
