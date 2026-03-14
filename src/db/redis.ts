import { createClient } from "redis";

let isRedisHealthy = false;

const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      console.log(`🔄 Redis reconnect attempt ${retries}`);
      return Math.min(retries * 500, 5000);
    },
  },
});

console.log("🔗 Redis URL:", process.env.REDIS_URL || "redis://localhost:6379");

client.on("error", (err) => {
  if (isRedisHealthy) {
    console.error("❌ Redis error, marking unhealthy:", err.message);
  }
  isRedisHealthy = false;
});

client.on("ready", () => {
  console.log("✅ Redis ready");
  isRedisHealthy = true;
});

client.on("reconnecting", () => {
  isRedisHealthy = false;
});

client.on("end", () => {
  console.log("⚠️ Redis connection closed");
  isRedisHealthy = false;
});

export const redis = client;

export function redisIsHealthy() {
  return isRedisHealthy;
}

export function markRedisUnhealthy() {
  if (isRedisHealthy) {
    console.warn("⚠️ Redis marked unhealthy (operation timeout), will reconnect...");
  }
  isRedisHealthy = false;
  // Force disconnect and reconnect
  tryReconnect();
}

let reconnecting = false;
async function tryReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    // Disconnect the stale connection
    try { await client.disconnect(); } catch {}
    // Reconnect
    await client.connect();
  } catch (error) {
    console.error("❌ Redis reconnect failed:", (error as Error).message);
  } finally {
    reconnecting = false;
  }
}

export async function connectRedis() {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
  } catch (error) {
    console.error("❌ Redis connection failed:", (error as Error).message);
    isRedisHealthy = false;
  }
}
