import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { cookie } from "@elysiajs/cookie";
import { connectRedis } from "./db/redis";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";
import { sportsRoutes } from "./routes/sports";
import { sportsWebSocketRoutes } from "./routes/sports-websocket";
import { bettingRoutes } from "./routes/betting";
import { casinoAggregatorRoutes } from "./routes/casino/aggregator";
import { casinoCallbackRoutes } from "./routes/casino/callback";
import { casinoGamesRoutes } from "./routes/casino/games";
import "dotenv/config";

// // Initialize services
async function initializeServices() {
  await connectRedis();
}
initializeServices();

const port = Number(process.env.PORT || 3001);

const app = new Elysia()
  .use(
    cors({
      origin: [
        "http://localhost:3000",
        "https://aiexch-two.vercel.app",
        "https://aiexch.com",
        "https://www.aiexch.com",
      ],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-whitelabel-domain"],
      credentials: true,
    })
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
  .use(authRoutes)
  .use(profileRoutes)
  .use(adminRoutes)
  .use(publicRoutes)
  .use(sportsRoutes)
  .use(sportsWebSocketRoutes)
  .use(bettingRoutes)
  .use(casinoAggregatorRoutes)
  .use(casinoCallbackRoutes)
  .use(casinoGamesRoutes)
  .get("/", () => ({ message: "AIEXCH Backend API" }))
  .get("/health", () => ({ status: "OK" }))
  .get("/debug-test", () => {
    console.log("=== DEBUG TEST ENDPOINT CALLED ===");
    return {
      message: "Debug test works!",
      timestamp: new Date().toISOString(),
    };
  })
  .all("/admin/*", ({ request, set }) => {
    console.log("=== ADMIN REQUEST CAUGHT BY WILDCARD ===");
    console.log("Method:", request.method);
    console.log("URL:", request.url);
    console.log("Path:", new URL(request.url).pathname);

    set.status = 404;
    return {
      message: "Admin routes not found - caught by wildcard",
      method: request.method,
      url: request.url,
      path: new URL(request.url).pathname,
    };
  });

// Bun has native WebSocket support, so we can use .listen() directly
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
  console.log(`📡 WebSocket support enabled`);
});
