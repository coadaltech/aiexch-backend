import { redis, redisIsHealthy, markRedisUnhealthy } from "@db/redis";

// ─── L1: In-Memory Cache (instant, never fails) ───
const memoryCache = new Map<string, { data: string; expiresAt: number }>();

function memGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

function memSet(key: string, value: string, ttlSeconds: number) {
  memoryCache.set(key, {
    data: value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  // Prevent unbounded memory growth — evict oldest if >2000 entries
  if (memoryCache.size > 2000) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
}

// ─── Redis timeout helper ───
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Redis timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

const REDIS_TIMEOUT = 5000;

// ─── CacheService: L1 (memory) → L2 (Redis) ───
export const CacheService = {
  async get<T>(key: string): Promise<T | null> {
    // L1: Check memory first (instant)
    const memResult = memGet(key);
    if (memResult) {
      try { return JSON.parse(memResult); } catch { return null; }
    }

    // L2: Check Redis
    if (!redisIsHealthy()) return null;
    try {
      const data = await withTimeout(redis.get(key), REDIS_TIMEOUT);
      if (data) {
        // Populate L1 for next request (short TTL so memory doesn't go stale)
        memSet(key, data, 30);
        return JSON.parse(data);
      }
      return null;
    } catch {
      markRedisUnhealthy();
      return null;
    }
  },

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    const serialized = JSON.stringify(value);

    // Always set in L1 memory (even if Redis is down)
    memSet(key, serialized, Math.min(ttl, 120)); // Memory TTL capped at 2 min

    // L2: Try Redis (non-blocking — don't let Redis failure block the response)
    if (!redisIsHealthy()) return;
    try {
      if (serialized.length > 500_000) {
        console.warn(`[Cache] Skipping oversized Redis key "${key}" (${(serialized.length / 1024).toFixed(0)}KB)`);
        return;
      }
      await withTimeout(redis.setEx(key, ttl, serialized), REDIS_TIMEOUT);
    } catch {
      markRedisUnhealthy();
    }
  },

  async del(key: string): Promise<void> {
    memoryCache.delete(key);
    if (!redisIsHealthy()) return;
    try {
      await withTimeout(redis.del(key), REDIS_TIMEOUT);
    } catch {
      markRedisUnhealthy();
    }
  },

  async invalidatePattern(pattern: string): Promise<void> {
    // Clear matching memory cache entries
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    for (const key of memoryCache.keys()) {
      if (regex.test(key)) memoryCache.delete(key);
    }

    if (!redisIsHealthy()) return;
    try {
      const keys = await withTimeout(redis.keys(pattern), REDIS_TIMEOUT);
      if (keys.length > 0) {
        await withTimeout(redis.del(keys), REDIS_TIMEOUT);
      }
    } catch {
      markRedisUnhealthy();
    }
  },
};
