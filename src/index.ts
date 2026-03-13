import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { cookie } from "@elysiajs/cookie";
import { connectRedis } from "./db/redis";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { ownerRoutes } from "./routes/owner";
import { publicRoutes } from "./routes/public";
import { sportsRoutes } from "./routes/sports";
import { bettingRoutes } from "./routes/betting";
import { casinoAggregatorRoutes } from "./routes/casino/aggregator";
import { casinoCallbackRoutes } from "./routes/casino/callback";
import { casinoGamesRoutes } from "./routes/casino/games";
import { startBetSettlementService } from "./services/bet-settlement";
import { AdminMarketService } from "@services/admin-market-service";
import { OddsHistoryWorker } from "@services/odds-history-worker";
import { seriesRoutes } from "./routes/series-route";
import "dotenv/config";
import { initSocket } from "@services/socket-service";
import { websocketRoutes } from "@routes/websocket";
import { startCronJobs } from "@db/seed";
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

// // Initialize services
async function initializeServices() {
  await connectRedis();
  await loadWhitelabelOrigins();
  // Sync admin market overrides from DB to Redis
  await AdminMarketService.syncOverridesToRedis();
  // Start odds history background worker
  await OddsHistoryWorker.init();
  // Start automatic bet settlement service
  startBetSettlementService();
}
initializeServices();

const port = Number(process.env.PORT || 3001);

const app = new Elysia()
  // Register WebSocket routes first — before CORS/cookie middleware
  // so the upgrade handshake isn't intercepted
  .use(
    cors({
      // Dynamic origin check — runs on every request against the live in-memory set.
      // New whitelabel domains are reflected immediately without a server restart.
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
        details: error.all, // array of all validation errors
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
  .use(sportsRoutes)
  .use(bettingRoutes)
  .use(casinoAggregatorRoutes)
  .use(casinoCallbackRoutes)
  .use(casinoGamesRoutes)
  .use(websocketRoutes)
  .listen(port)

// .all("/*", ({ request, set }) => {
//   // console.log("=== CATCH-ALL WILDCARD ===");
//   // console.log("Method:", request.method);
//   // console.log("URL:", request.url);
//   // console.log("Path:", new URL(request.url).pathname);
//
//   set.status = 404;
//   return {
//     message: "Route not found - caught by wildcard",
//     method: request.method,
//     url: request.url,
//     path: new URL(request.url).pathname,
//   };
// });

console.log(`🚀 Server is running on http://localhost:${port}`);
// console.log(`📡 WebSocket support enabled`);

// startCronJobs()

// let a  =async function(){
//   let result = await db.delete(competitions).where(lte(competitions.created_at, new Date("2026-03-05 07:27:40.702")));
// }
// a();

initSocket();

console.log(`🔌 WebSocket server initialized`);
