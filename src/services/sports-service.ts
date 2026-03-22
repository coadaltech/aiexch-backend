// src/services/sports-service.ts
import { db } from "@db/index";
import { sports } from "@db/schema";
import { CacheService } from "./cache";

export const getAvailableSportsList = async () => {
  try {
    const cacheKey = "sports:list";
    const cached = await CacheService.get<any[]>(cacheKey);

    if (cached) {
      return cached;
    }


    // Retry once — Neon cold start may fail the first query
    let sportsData;
    try {
      sportsData = await db.select().from(sports);
    } catch (firstError) {
      console.warn("First DB query failed (possible cold start), retrying in 3s...");
      await new Promise(r => setTimeout(r, 3000));
      sportsData = await db.select().from(sports);
    }

    const transformedData = sportsData.map((sport) => ({
      id: sport.sport_id,
      name: sport.name,
      is_active: sport.is_active,
      sort_order: sport.sort_order,
      addedDate: sport.addedDate,
      updateDate: sport.updateDate,
    }));

    await CacheService.set(cacheKey, transformedData, 300);

    return transformedData;
  } catch (error) {
    console.error("Error fetching sports from database:", error);
    return [];
  }
};
