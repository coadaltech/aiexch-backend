import { redis } from "@db/redis";

export const CacheService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!redis.isOpen) return null;
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Cache get error:");
      return null;
    }
  },

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      if (!redis.isOpen) return;
      await redis.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error("Cache set error:");
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error("Cache delete error:");
    }
  },

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } catch (error) {
      console.error("Cache invalidate error:");
    }
  },
};
