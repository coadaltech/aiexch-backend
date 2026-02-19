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
import { seriesRoutes } from "./routes/series-route";
import "dotenv/config";
import { initSocket } from "@services/socket-service";
import { websocketRoutes } from "@routes/websocket";
import { startCronJobs } from "@db/seed";
import { gamesRoutes } from "@routes/dashboard/games-routes";
import { competitions } from "@db/schema";
import { db } from "./db";


// // Initialize services
async function initializeServices() {
  await connectRedis();
  // Start automatic bet settlement service
  startBetSettlementService();
}
initializeServices();

const port = Number(process.env.PORT || 3001);

// Temporarily allow all origins for development
// Set ALLOW_ALL_ORIGINS=true in .env to enable this (works in production too)
const allowAllOrigins = false;
// process.env.ALLOW_ALL_ORIGINS === "true" ||
// process.env.NODE_ENV !== "production";

const app = new Elysia()
  // Register WebSocket routes first — before CORS/cookie middleware
  // so the upgrade handshake isn't intercepted
  .use(
    cors({
      origin: allowAllOrigins
        ? true // Allow all origins - useful for local dev connecting to prod
        : [
          "http://localhost:3002",
          "http://localhost:3000",
          "http://localhost:3001",
          "http://10.42.0.1:3002",
          "http://10.42.0.1:3000",
          "http://10.42.0.1:3001",
          "https://aiexch-two.vercel.app",
          "https://aiexch.com",
          "https://www.aiexch.com",
        ],
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
console.log(`📡 WebSocket support enabled`);

// startCronJobs()

initSocket();

console.log(`🔌 WebSocket server initialized`);
