import { createClient } from "redis";

let isRedisHealthy = false;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_UNHEALTHY = 20;
let lastFailureTime = 0;
const FAILURE_WINDOW_MS = 30000;

const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    connectTimeout: 15000,
    reconnectStrategy: (retries) => {
      console.log(`Redis reconnect attempt ${retries}`);
      // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
      return Math.min(retries * 1000, 15000);
    },
  },
});

console.log("Redis URL:", process.env.REDIS_URL || "redis://localhost:6379");

client.on("error", (err) => {
  if (isRedisHealthy) {
    console.error("Redis error:", err.message);
  }
  isRedisHealthy = false;
});

client.on("ready", () => {
  console.log("Redis ready");
  isRedisHealthy = true;
  consecutiveFailures = 0;
});

client.on("reconnecting", () => {
  isRedisHealthy = false;
});

client.on("end", () => {
  console.log("Redis connection closed");
  isRedisHealthy = false;
});

export const redis = client;

export function redisIsHealthy() {
  return isRedisHealthy && client.isOpen;
}

/**
 * Track Redis operation failures.
 * After too many failures in a short window, mark unhealthy.
 * Recovery happens automatically via the "ready" event when Redis reconnects.
 */
export function markRedisUnhealthy() {
  const now = Date.now();

  // Reset counter if no failures for a while
  if (now - lastFailureTime > FAILURE_WINDOW_MS) {
    consecutiveFailures = 0;
  }
  lastFailureTime = now;
  consecutiveFailures++;

  if (consecutiveFailures >= MAX_FAILURES_BEFORE_UNHEALTHY && isRedisHealthy) {
    console.warn(`[Redis] Marked unhealthy after ${consecutiveFailures} failures — will auto-recover when connection restores`);
    isRedisHealthy = false;
  }
}

// Periodically check if Redis recovered (every 30s)
// This handles the case where Redis reconnects but no "ready" event fires
setInterval(async () => {
  if (!isRedisHealthy && client.isOpen) {
    try {
      await client.ping();
      console.log("[Redis] Health check passed — marking healthy");
      isRedisHealthy = true;
      consecutiveFailures = 0;
    } catch {
      // still down
    }
  }
}, 30000);

export async function flushRedis() {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
    await client.flushAll();
    console.log("Redis flushed successfully — all keys cleared");
  } catch (error) {
    console.error("Redis flush failed:", (error as Error).message);
  }
}

export async function connectRedis() {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
  } catch (error) {
    console.error("Redis connection failed:", (error as Error).message);
    isRedisHealthy = false;
  }
}
