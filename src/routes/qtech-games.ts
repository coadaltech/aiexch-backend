import { Elysia, t } from "elysia";
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
 *   POST /qtech-casino/launch   public  : launch URL (DEMO mode by default,
 *                                          so games open without the wallet)
 *   GET  /qtech-casino/health   diag    : client/config status
 *
 * Real-money launches (mode=real, requiring walletSessionId) land once the
 * Common Wallet callbacks are wired. For now demo mode lets us see and play
 * the games end-to-end in the UI.
 */

// Small in-memory cache so the lobby doesn't re-hit QT on every page load.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: { totalCount: number; games: QtechLobbyGame[] } } | null = null;

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

  .post(
    "/launch",
    async ({ body, set }) => {
      const b = body as {
        gameId: string;
        mode?: "demo" | "real";
        currency?: string;
        device?: "desktop" | "mobile";
        returnUrl?: string;
      };
      if (!b?.gameId) {
        set.status = 400;
        return { success: false, message: "gameId is required" };
      }
      try {
        const resp = await getLaunchUrl({
          gameId: b.gameId,
          mode: b.mode || "demo",
          currency: b.currency,
          device: b.device,
          returnUrl: b.returnUrl,
        });
        if (!resp?.url) {
          set.status = 502;
          return { success: false, message: "Launch URL not returned", upstream: resp };
        }
        return { success: true, url: resp.url, gameId: b.gameId };
      } catch (err: any) {
        const upstream = err?.response?.data ?? err?.message ?? String(err);
        set.status = 502;
        return { success: false, message: "Failed to generate launch URL", upstream };
      }
    },
    {
      body: t.Object({
        gameId: t.String(),
        mode: t.Optional(t.Union([t.Literal("demo"), t.Literal("real")])),
        currency: t.Optional(t.String()),
        device: t.Optional(t.Union([t.Literal("desktop"), t.Literal("mobile")])),
        returnUrl: t.Optional(t.String()),
      }),
    },
  )

  .get("/health", () => ({ success: true, ...clientInfo() }));
