import { redis, redisIsHealthy, markRedisUnhealthy } from "@db/redis";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Redis timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

const REDIS_TIMEOUT = 3000;

export const CacheService = {
  async get<T>(key: string): Promise<T | null> {
    if (!redisIsHealthy()) return null;
    try {
      const data = await withTimeout(redis.get(key), REDIS_TIMEOUT);
      return data ? JSON.parse(data) : null;
    } catch {
      markRedisUnhealthy();
      return null;
    }
  },

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    if (!redisIsHealthy()) return;
    try {
      await withTimeout(redis.setEx(key, ttl, JSON.stringify(value)), REDIS_TIMEOUT);
    } catch {
      markRedisUnhealthy();
    }
  },

  async del(key: string): Promise<void> {
    if (!redisIsHealthy()) return;
    try {
      await withTimeout(redis.del(key), REDIS_TIMEOUT);
    } catch {
      markRedisUnhealthy();
    }
  },

  async invalidatePattern(pattern: string): Promise<void> {
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
