import { Elysia, t } from "elysia";
import crypto from "crypto";
import { db } from "@db/index";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { CacheService } from "../services/cache";
import {
  listGamesPage,
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

// Each catalogue page is cached in Redis (via CacheService's L1-memory →
// L2-Redis tiers) so the lobby loads instantly on refresh / re-entry instead of
// re-hitting QT. Cache is keyed by the page's params (size + cursor + filters)
// so every infinite-scroll page is cached independently.
//
// Strategy = stale-while-revalidate:
//   • SOFT_TTL — after this the cached page is still served INSTANTLY, but we
//     kick off a background refresh so the next request gets fresh data.
//   • HARD_TTL — how long the entry physically survives in Redis. Kept long so a
//     page is essentially always warm (and survives a backend restart), which
//     is what makes the first 100-150 games appear instantly.
type PageData = { totalCount: number; games: QtechLobbyGame[]; nextCursor: string | null };
type CachedPage = { at: number; data: PageData };

const SOFT_TTL_MS = 5 * 60 * 1000; // 5 min → refresh in background after this
const HARD_TTL_S = 60 * 60; // keep in Redis up to 1h so it's always warm

function cacheKeyFor(opts: Record<string, unknown>) {
  return `qtech:games:${JSON.stringify(opts)}`;
}

// De-dupe concurrent upstream fetches for the same page (cache stampede guard):
// if 50 users hit a cold first page at once, we call QT once and share the result.
const inflight = new Map<string, Promise<PageData>>();

async function fetchAndCache(cacheKey: string, opts: any): Promise<PageData> {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;
  const p = (async () => {
    const data = await listGamesPage(opts);
    await CacheService.set(cacheKey, { at: Date.now(), data } as CachedPage, HARD_TTL_S);
    return data;
  })().finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

// Default per-page size. Big enough to fill the first screen (and seed the
// category tabs) in one fast round-trip, small enough to stay well under any
// request timeout. Further pages load on scroll / category change.
const DEFAULT_PAGE_SIZE = 200;

/**
 * Pre-warm the first catalogue page into Redis on startup, so the very first
 * visitor after a deploy gets the lobby instantly instead of paying for the
 * cold QT round-trip. Non-fatal: a failure (e.g. QT IP not whitelisted on this
 * box) just means the first real request warms the cache instead.
 */
export async function warmGamesCache(): Promise<void> {
  const opts = {
    size: DEFAULT_PAGE_SIZE,
    cursor: null,
    providers: undefined,
    currencies: undefined,
    gameTypes: undefined,
  };
  await fetchAndCache(cacheKeyFor(opts), opts);
}

// Default game-launch currency. The user's wallet is tracked in this currency
// for QTech rounds until per-user currency selection lands.
const DEFAULT_CURRENCY = process.env.QT_LAUNCH_CURRENCY || "USD";
// QTech caps playerId at 34 chars; usernames are 50. Truncate defensively.
const PLAYER_ID_MAX = 34;

export const qtechGamesRoutes = new Elysia({ prefix: "/qtech-casino" })
  .get("/games", async ({ query, set }) => {
    // One catalogue page per request. `cursor` (echoed back from a previous
    // response's nextCursor) walks the pages; the lobby requests the next page
    // on scroll / category change, so no single request loads the whole ~13k
    // catalogue and there is no timeout.
    const size = query?.size ? Number(query.size) : DEFAULT_PAGE_SIZE;
    const cursor = query?.cursor || null;
    const opts = {
      size,
      cursor,
      providers: query?.providers,
      currencies: query?.currencies,
      gameTypes: query?.gameTypes,
    };
    const cacheKey = cacheKeyFor(opts);
    const nocache = query?.refresh === "1";

    if (!nocache) {
      const cached = await CacheService.get<CachedPage>(cacheKey);
      if (cached?.data) {
        // Stale-while-revalidate: serve instantly. If the entry is past its soft
        // TTL, refresh in the background (fire-and-forget) so the next request is
        // fresh — the current caller never waits on QT.
        if (Date.now() - cached.at > SOFT_TTL_MS) {
          void fetchAndCache(cacheKey, opts).catch(() => {});
        }
        return { success: true, cached: true, ...cached.data };
      }
    }

    try {
      const data = await fetchAndCache(cacheKey, opts);
      return { success: true, cached: false, ...data };
    } catch (err: any) {
      const upstream = err?.response?.data ?? err?.message ?? String(err);
      set.status = 502;
      return { success: false, message: "Failed to load games from QT", upstream };
    }
  })

  // Authed from here on. /games above is public for the lobby grid.
  .resolve(async ({ cookie, headers, status, path, request }) => {
    if (path === "/qtech-casino/games" || path === "/qtech-casino/health") {
      return { userId: "", username: "" };
    }
    const result = await app_middleware({ cookie, headers, request });
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

      const launchReq = {
        gameId: b.gameId,
        mode: "real" as const,
        currency: b.currency || DEFAULT_CURRENCY,
        device: b.device,
        returnUrl: b.returnUrl,
        playerId,
        walletSessionId,
        country: "IN",
      };
      // eslint-disable-next-line no-console
      console.log("[qtech:launch] →", JSON.stringify(launchReq));
      try {
        const resp = await getLaunchUrl(launchReq);
        if (!resp?.url) {
          // eslint-disable-next-line no-console
          console.log(
            "[qtech:launch] ← NO URL",
            JSON.stringify({ resp: resp ?? null }),
          );
          set.status = 502;
          return { success: false, message: "Launch URL not returned", upstream: resp };
        }
        // eslint-disable-next-line no-console
        console.log("[qtech:launch] qweqwewqe←", JSON.stringify({ url: resp.url }));
        return {
          success: true,
          url: resp.url,
          gameId: b.gameId,
          mode: "real",
          walletSessionId,
        };
      } catch (err: any) {
        const status = err?.response?.status;
        const upstream = err?.response?.data ?? err?.message ?? String(err);
        // eslint-disable-next-line no-console
        console.log(
          "[qtech:launch] ← ERROR",
          JSON.stringify({ status, upstream }),
        );
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
