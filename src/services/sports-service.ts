// src/services/sports-service.ts
import { db } from "@db/index";
import { sports } from "@db/schema";
import { redis } from "@db/redis";

export const getAvailableSportsList = async () => {
  try {
    // 1. Check Redis cache first (5 minutes = 300 seconds)
    const cacheKey = "sports:list";
    const cached = await redis.get(cacheKey);

    // console.log("dsfjsdfkschut")
    if (cached) {
      console.log("✅ Returning cached sports data");
      return JSON.parse(cached);
    }

    console.log("🔄 Fetching sports from database...");

    // 2. Fetch ALL data from sports table
    const sportsData = await db.select().from(sports);

    console.log(`✅ Found ${sportsData.length} sports in database`);

    // 3. Transform to match expected format
    const transformedData = sportsData.map((sport) => ({
      id: sport.sport_id,
      name: sport.name,
      is_active: sport.is_active,
      sort_order: sport.sort_order,
      created_at: sport.created_at,
      updated_at: sport.updated_at,
    }));

    // 4. Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(transformedData), { EX: 300 });

    return transformedData;
  } catch (error) {
    console.error("❌ Error fetching sports from database:", error);
    return [];
  }
};
