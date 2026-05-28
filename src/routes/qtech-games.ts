import { Elysia, t } from "elysia";
import crypto from "crypto";
import { db } from "@db/index";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import {
  listGames,
  getLaunchUrl,
  clientInfo,
  type QtechLobbyGame,
} from "../services/casino/qtech-platform-client";

/**
 * QTech casino — read/launch routes that power the frontend lobby.
 *
 *   GET  /qtech-casino/games    public  : list of games from QT (cached)
 *   POST /qtech-casino/launch   authed  : launch URL in REAL mode for the
 *                                          logged-in user. Generates a wallet
 *                                          session id that QT will hand back
 *                                          on every Common Wallet callback.
 *   GET  /qtech-casino/health   diag    : client/config status
 */

// Small in-memory cache so the lobby doesn't re-hit QT on every page load.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: { totalCount: number; games: QtechLobbyGame[] } } | null = null;

// Default game-launch currency. The user's wallet is tracked in this currency
// for QTech rounds until per-user currency selection lands.
const DEFAULT_CURRENCY = process.env.QT_LAUNCH_CURRENCY || "USD";
// QTech caps playerId at 34 chars; usernames are 50. Truncate defensively.
const PLAYER_ID_MAX = 34;

export const qtechGamesRoutes = new Elysia({ prefix: "/qtech-casino" })
  .get("/games", async ({ query, set }) => {
    const nocache = query?.refresh === "1";
    if (!nocache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return { success: true, cached: true, ...cache.data };
    }
    try {
      const data = await listGames({
        size: query?.size ? Number(query.size) : 500,
        providers: query?.providers,
        currencies: query?.currencies,
        gameTypes: query?.gameTypes,
      });
      cache = { at: Date.now(), data };
      return { success: true, cached: false, ...data };
    } catch (err: any) {
      const upstream = err?.response?.data ?? err?.message ?? String(err);
      set.status = 502;
      return { success: false, message: "Failed to load games from QT", upstream };
    }
  })

  // Authed from here on. /games above is public for the lobby grid.
  .resolve(async ({ cookie, headers, status, path }) => {
    if (path === "/qtech-casino/games" || path === "/qtech-casino/health") {
      return { userId: "", username: "" };
    }
    const result = await app_middleware({ cookie, headers });
    if (!result.data) {
      return status(result.code as 401 | 403 | 404 | 500, result);
    }
    const [u] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, result.data.id))
      .limit(1);
    if (!u) {
      return status(401, { success: false, message: "User not found" });
    }
    return { userId: u.id, username: u.username };
  })

  .post(
    "/launch",
    async ({ body, set, username }) => {
      const b = body as {
        gameId: string;
        currency?: string;
        device?: "desktop" | "mobile";
        returnUrl?: string;
      };
      if (!b?.gameId) {
        set.status = 400;
        return { success: false, message: "gameId is required" };
      }
      // QT's playerId is the identifier they echo back on every callback,
      // so we use username (unique, human-readable) truncated to QT's 34-char cap.
      const playerId = (username || "").slice(0, PLAYER_ID_MAX);
      if (!playerId) {
        set.status = 401;
        return { success: false, message: "Missing player identity" };
      }
      // Wallet session is just an opaque token QT echoes back. We don't yet
      // bind it to a DB row — callbacks identify the user from the URL's
      // playerId. (Session-binding lands when wallet moves do.)
      const walletSessionId = crypto.randomUUID();

      try {
        const resp = await getLaunchUrl({
          gameId: b.gameId,
          mode: "real",
          currency: b.currency || DEFAULT_CURRENCY,
          device: b.device,
          returnUrl: b.returnUrl,
          playerId,
          walletSessionId,
          country: "IN",
        });
        if (!resp?.url) {
          set.status = 502;
          return { success: false, message: "Launch URL not returned", upstream: resp };
        }
        return {
          success: true,
          url: resp.url,
          gameId: b.gameId,
          mode: "real",
          walletSessionId,
        };
      } catch (err: any) {
        const upstream = err?.response?.data ?? err?.message ?? String(err);
        set.status = 502;
        return { success: false, message: "Failed to generate launch URL", upstream };
      }
    },
    {
      body: t.Object({
        gameId: t.String(),
        currency: t.Optional(t.String()),
        device: t.Optional(t.Union([t.Literal("desktop"), t.Literal("mobile")])),
        returnUrl: t.Optional(t.String()),
      }),
    },
  )

  .get("/health", () => ({ success: true, ...clientInfo() }));
