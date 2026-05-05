// src/services/sports-service.ts
import { db } from "@db/index";
import { sports } from "@db/schema";
import { asc, eq } from "drizzle-orm";
import { CacheService } from "./cache";

const CACHE_KEY_ALL = "sports:list:all";
const CACHE_KEY_ACTIVE = "sports:list:active";

export const SPORTS_CACHE_KEYS = [CACHE_KEY_ALL, CACHE_KEY_ACTIVE, "sports:list"];

export const invalidateSportsListCache = async () => {
  await Promise.all(SPORTS_CACHE_KEYS.map((k) => CacheService.del(k)));
};

export const getAvailableSportsList = async (
  options: { includeInactive?: boolean } = {},
) => {
  const { includeInactive = false } = options;
  const cacheKey = includeInactive ? CACHE_KEY_ALL : CACHE_KEY_ACTIVE;

  try {
    const cached = await CacheService.get<any[]>(cacheKey);
    if (cached) return cached;

    // Retry once — Neon cold start may fail the first query
    const fetchRows = async () => {
      const query = db.select().from(sports).orderBy(asc(sports.sort_order));
      return includeInactive
        ? await query
        : await db
            .select()
            .from(sports)
            .where(eq(sports.is_active, true))
            .orderBy(asc(sports.sort_order));
    };

    let sportsData;
    try {
      sportsData = await fetchRows();
    } catch (firstError) {
      console.warn("First DB query failed (possible cold start), retrying in 3s...");
      await new Promise((r) => setTimeout(r, 3000));
      sportsData = await fetchRows();
    }

    const transformedData = sportsData.map((sport) => ({
      id: sport.sport_id,
      name: sport.name,
      is_active: sport.is_active,
      isActive: sport.is_active,
      is_live: sport.is_live,
      isLive: sport.is_live,
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
