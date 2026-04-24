import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { cookie } from "@elysiajs/cookie";
import { connectRedis, redis, redisIsHealthy } from "./db/redis";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { ownerRoutes } from "./routes/owner";
import { publicRoutes } from "./routes/public";
import { multimarketsRoutes } from "./routes/multimarkets";
import { sportsRoutes } from "./routes/sports";
import { bettingRoutes } from "./routes/betting";
import { casinoAggregatorRoutes } from "./routes/casino/aggregator";
import { casinoCallbackRoutes } from "./routes/casino/callback";
import { casinoGamesRoutes } from "./routes/casino/games";
import { startBetSettlementService } from "./services/bet-settlement";
import { startMarketResultCronJobs } from "./services/market-result-cron-service";
import { AdminMarketService } from "@services/admin-market-service";
import { OddsHistoryWorker } from "@services/odds-history-worker";
import { seriesRoutes } from "./routes/series-route";
import { matkaRoutes } from "./routes/matka";
import { jamboRoutes } from "./routes/jambo";
import { startMatkaShiftCron } from "./services/matka-shift-cron-service";
import "dotenv/config";
import { websocketRoutes } from "@routes/websocket";
import { startCronJobs, ensureSystemUser } from "@db/seed";
import { gamesRoutes } from "@routes/dashboard/games-routes";
import { competitions, whitelabels } from "@db/schema";
import { db } from "./db";
import { dynamicOrigins, addAllowedOrigin } from "./utils/cors-origins";
import { lte } from "drizzle-orm";

// On startup, load all existing whitelabel domains from DB so they survive restarts.
async function loadWhitelabelOrigins() {
  try {
    const rows = await db.select({ domain: whitelabels.domain }).from(whitelabels);
    for (const row of rows) {
      if (row.domain) addAllowedOrigin(row.domain);
    }
    console.log(`[CORS] Loaded ${rows.length} whitelabel domain(s) into allow-list`);
  } catch (e) {
    console.error("[CORS] Failed to load whitelabel origins:", e);
  }
}

const port = Number(process.env.PORT || 3001);

const app = new Elysia()
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        if (!origin) return false;
        return dynamicOrigins.has(origin);
      },
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-whitelabel-domain"],
      credentials: true,
    }),
  )
  .use(cookie())

  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return {
        success: false,
        message: "Validation failed",
        details: error.all,
      };
    }

    return {
      success: false,
      message:
        error instanceof Error && (error.message || "Internal server error"),
    };
  })

  .get("/", () => ({ message: "AIEXCH Backend API" }))
  .get("/health", () => ({ status: "OK" }))

  .use(seriesRoutes)
  .use(authRoutes)
  .use(profileRoutes)
  .use(ownerRoutes)
  .use(gamesRoutes)
  .use(publicRoutes)
  .use(multimarketsRoutes)
  .use(sportsRoutes)
  .use(bettingRoutes)
  .use(casinoAggregatorRoutes)
  .use(casinoCallbackRoutes)
  .use(casinoGamesRoutes)
  .use(websocketRoutes)
  .use(matkaRoutes)
  .use(jamboRoutes)
  .listen(port);


  
console.log(`Server is running on http://localhost:${port}`);

// Initialize ALL services BEFORE accepting real traffic
// This runs async but the server is already listening for health checks
async function initializeServices() {
  // Step 0: Ensure the "system" user exists (used as default for audit columns)
  await ensureSystemUser();
  console.log("[Init] System user ensured");
  // initializeuserservice comments

  // Step 1: Connect Redis (non-blocking — app works without it via in-memory cache)
  await connectRedis();
  console.log("[Init] Redis connection attempted");

  // Step 2: Load whitelabel domains (needs DB)
  await loadWhitelabelOrigins();
  console.log("[Init] Whitelabel origins loaded");

  // Step 3: Sync admin overrides from DB to Redis
  // try {
  //   await AdminMarketService.syncOverridesToRedis();
  //   console.log("[Init] Admin overrides synced");
  // } catch (e) {
  //   console.error("[Init] Admin sync failed (non-fatal):", e);
  // }

  // Step 4: Start odds history worker
  try {
    await OddsHistoryWorker.init();
    console.log("[Init] OddsHistory worker started");
  } catch (e) {
    console.error("[Init] OddsHistory init failed (non-fatal):", e);
  }

  // Step 5: Start bet settlement
  // startBetSettlementService();
  console.log("[Init] Bet settlement started");

  // Step 5b: Start market result cron jobs (10min Fancy, 15min Odds/Bookmaker)
  try {
    startMarketResultCronJobs();
    console.log("[Init] Market result cron jobs started");
  } catch (e) {
    console.error("[Init] Market result cron failed (non-fatal):", e);
  }

  // Step 5c: Start matka shift date cron (daily 10:00 AM IST)
  try {
    startMatkaShiftCron();
    console.log("[Init] Matka shift date cron started");
  } catch (e) {
    console.error("[Init] Matka shift cron failed (non-fatal):", e);
  }

  // // Step 6: Start sports & competitions sync cron jobs
  try {
    await startCronJobs();
    console.log("[Init] Sports/competitions sync cron started");
  } catch (e) {
    console.error("[Init] Sports sync cron failed (non-fatal):", e);
  }

  // Step 6: Clean up stale Redis keys and trim bloated streams
  await cleanupRedis();

  console.log("[Init] All services ready");
}

/** One-time Redis cleanup on startup: remove stale keys and trim streams */
async function cleanupRedis() {
  try {
    if (!redisIsHealthy()) return;

    // Trim the odds history stream aggressively (keep 10K max)
    const streamLen = await redis.xLen("stream:odds:history");
    if (streamLen > 10_000) {
      await redis.xTrim("stream:odds:history", "MAXLEN", 10_000);
      console.log(`[Redis Cleanup] Trimmed stream:odds:history from ${streamLen} to ~10K entries`);
    }

    // Delete stale lastsnapshot:* keys (no longer needed, dedup is in-memory now)
    let cursor = 0;
    let deletedCount = 0;
    do {
      const result = await redis.scan(cursor, { MATCH: "lastsnapshot:*", COUNT: 200 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await redis.del(result.keys);
        deletedCount += result.keys.length;
      }
    } while (cursor !== 0);

    if (deletedCount > 0) {
      console.log(`[Redis Cleanup] Deleted ${deletedCount} stale lastsnapshot:* keys`);
    }

    console.log("[Redis Cleanup] Done");
  } catch (e) {
    console.error("[Redis Cleanup] Error (non-fatal):", e);
  }
}

initializeServices().catch((e) => {
  console.error("[Init] FATAL — service initialization failed:", e);
});
