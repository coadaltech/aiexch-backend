import { randomUUID } from "crypto";
import { redis } from "../db/redis";
import { dynamicOrigins } from "./cors-origins";

// ─────────────────────────────────────────────────────────────────────────────
// Bet placement request guards.
//
// These exist to make it hard to place a bet from anything other than the real
// frontend (Postman, curl, scripts, replayed captures). None of them can make
// it *impossible* for an attacker who holds a live auth token — a stolen token
// is a theft problem solved by HttpOnly/Secure cookies + HTTPS — but together
// they block the casual tool, the scripted abuser, and the replayed request,
// which is the realistic threat.
// ─────────────────────────────────────────────────────────────────────────────

// 1) ORIGIN ALLOW-LIST ────────────────────────────────────────────────────────
// CORS is enforced by browsers, not the server — Postman/curl simply ignore the
// missing CORS headers and the request still reaches the handler. This is the
// explicit server-side gate: a request whose Origin (or Referer origin) isn't a
// known frontend is rejected. Set BET_ORIGIN_ENFORCE=false to disable, e.g. if a
// native app that sends no Origin header needs to place bets.
const ORIGIN_ENFORCE = process.env.BET_ORIGIN_ENFORCE !== "false";

export function checkRequestOrigin(request: Request): { ok: boolean; reason?: string } {
  if (!ORIGIN_ENFORCE) return { ok: true };

  let candidate = request.headers.get("origin");
  // Some browser contexts omit Origin but send Referer — derive the origin.
  if (!candidate) {
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = null;
      }
    }
  }

  if (!candidate || !dynamicOrigins.has(candidate)) {
    return { ok: false, reason: "Bet rejected: invalid request source" };
  }
  return { ok: true };
}

// 2) PER-USER RATE LIMIT ──────────────────────────────────────────────────────
// Fixed-window counter in Redis. Caps how many bets one user can fire per
// window so a valid-token script can't drain at machine speed. Fail-open: if
// Redis is down we don't block legitimate users.
const RATE_MAX = parseInt(process.env.BET_RATE_MAX || "15", 10); // bets per window
const RATE_WINDOW_SEC = parseInt(process.env.BET_RATE_WINDOW_SEC || "10", 10);

export async function checkBetRateLimit(userId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!redis.isReady) return { ok: true };
    const key = `bet:rate:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      // First hit in this window — start the TTL.
      await redis.expire(key, RATE_WINDOW_SEC);
    }
    if (count > RATE_MAX) {
      return { ok: false, reason: "Bet rejected: too many bets in a short time, please slow down" };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// 3) ONE-TIME, MARKET-BOUND BET NONCE ─────────────────────────────────────────
// The frontend requests a short-lived token when the bet slip opens, then echoes
// it in the /place body. The token is single-use (atomic GETDEL) and bound to
// the market, so a captured payload can't be replayed and a token minted for one
// market can't be reused on another.
//
// REQUIRE_BET_TOKEN gates enforcement: leave it off until the frontend is wired
// to send the token, then flip it on. When off, a token is still validated *if
// present* (no downside to early adoption), but its absence is allowed.
const REQUIRE_BET_TOKEN = process.env.REQUIRE_BET_TOKEN === "true";
const BET_TOKEN_TTL_SEC = parseInt(process.env.BET_TOKEN_TTL_SEC || "120", 10);

export async function issueBetToken(userId: string, marketId: string): Promise<string | null> {
  try {
    if (!redis.isReady) return null;
    const token = randomUUID();
    await redis.set(`bet:token:${userId}:${token}`, String(marketId), {
      EX: BET_TOKEN_TTL_SEC,
      NX: true,
    });
    return token;
  } catch {
    return null;
  }
}

export async function consumeBetToken(
  userId: string,
  token: string | undefined,
  marketId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!token) {
    // No token supplied. Reject only when enforcement is on (frontend updated).
    return REQUIRE_BET_TOKEN
      ? { ok: false, reason: "Bet rejected: missing bet token, please refresh and try again" }
      : { ok: true };
  }

  try {
    if (!redis.isReady) {
      // Can't validate. Fail-closed when enforcing (security), open otherwise.
      return REQUIRE_BET_TOKEN
        ? { ok: false, reason: "Bet rejected: unable to validate request, please try again" }
        : { ok: true };
    }
    // Atomic read-and-delete makes the token strictly single-use.
    const stored = await redis.getDel(`bet:token:${userId}:${token}`);
    if (!stored) {
      return { ok: false, reason: "Bet rejected: invalid or already-used bet token, please refresh" };
    }
    if (String(stored) !== String(marketId)) {
      return { ok: false, reason: "Bet rejected: bet token does not match this market" };
    }
    return { ok: true };
  } catch {
    return REQUIRE_BET_TOKEN
      ? { ok: false, reason: "Bet rejected: unable to validate request, please try again" }
      : { ok: true };
  }
}
