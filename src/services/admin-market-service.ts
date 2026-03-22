import { redis } from "@db/redis";
import { db } from "@db/index";
import {
  events,
  marketSettings,
  runnerSettings,
  customMarketOdds,
  users,
} from "@db/schema";
import { eq, and } from "drizzle-orm";
import { parseMarketType, marketTypeToString } from "../types/enums";
import { SportsService } from "./sports";
import dummysports from "../dummy/sportsevents.json";

// Helper: convert runner's back/lay arrays to Redis JSON format
function buildRunnerRedisJson(
  name: string,
  back: { price: number; size: number }[],
  lay: { price: number; size: number }[]
) {
  return JSON.stringify({
    name,
    back: back.length > 0 ? back : null,
    lay: lay.length > 0 ? lay : null,
  });
}

// Helper: get whitelabelId for a user
async function getUserWhitelabelId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ whitelabelId: users.whitelabelId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.whitelabelId || null;
}

export const AdminMarketService = {
  // ═══════════════════════════════════════════════════════════
  //  EVENT-LEVEL OPERATIONS
  // ═══════════════════════════════════════════════════════════

  async getEventSettings(eventId: string) {
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.eventId, Number(eventId)))
      .limit(1);
    return rows[0] || null;
  },

  async upsertEventSettings(
    eventId: string,
    data: {
      competitionId?: string;
      sportId?: string;
      name?: string;
      isActive?: boolean;
      isVisible?: boolean;
      suspended?: boolean;
      betDelay?: number;
      maxMarketProfit?: number;
      whitelabelId?: string;
    }
  ) {
    const existing = await db
      .select()
      .from(events)
      .where(eq(events.eventId, Number(eventId)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(events)
        .set({
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.isVisible !== undefined && { isVisible: data.isVisible }),
          ...(data.suspended !== undefined && { suspended: data.suspended }),
          ...(data.betDelay !== undefined && { betDelay: data.betDelay }),
          ...(data.maxMarketProfit !== undefined && {
            maxMarketProfit: String(data.maxMarketProfit),
          }),
          ...(data.name && { name: data.name }),
          ...(data.competitionId && { competitionId: Number(data.competitionId) }),
          ...(data.sportId && { sportId: Number(data.sportId) }),
        })
        .where(eq(events.eventId, Number(eventId)));
    } else {
      await db.insert(events).values({
        eventId: Number(eventId),
        competitionId: Number(data.competitionId || 0),
        sportId: Number(data.sportId || 0),
        name: data.name || "",
        whitelabelId: data.whitelabelId || undefined,
        isActive: data.isActive ?? true,
        isVisible: data.isVisible ?? true,
        suspended: data.suspended ?? false,
        betDelay: data.betDelay ?? 0,
        maxMarketProfit: data.maxMarketProfit
          ? String(data.maxMarketProfit)
          : undefined,
      });
    }

    // Sync to Redis for instant effect on next 1s poll cycle
    const hash: Record<string, string> = {};
    if (data.isActive !== undefined) hash.isActive = String(data.isActive);
    if (data.isVisible !== undefined) hash.isVisible = String(data.isVisible);
    if (data.suspended !== undefined) hash.suspended = String(data.suspended);
    if (data.betDelay !== undefined) hash.betDelay = String(data.betDelay);

    if (Object.keys(hash).length > 0 && redis.isOpen) {
      await redis.hSet(`admin:event:${eventId}`, hash);
    }

    return { success: true, eventId };
  },

  // ═══════════════════════════════════════════════════════════
  //  MARKET-LEVEL OPERATIONS
  // ═══════════════════════════════════════════════════════════

  async getMarketSettings(marketId: string) {
    const rows = await db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.marketId, marketId))
      .limit(1);
    return rows[0] || null;
  },

  async listMarketsByEvent(eventId: string) {
    return db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.eventId, Number(eventId)));
  },

  async upsertMarketSettings(
    marketId: string,
    data: {
      eventId?: string;
      marketName?: string;
      marketType?: string;
      bettingType?: string;
      isActive?: boolean;
      isVisible?: boolean;
      suspended?: boolean;
      betLock?: boolean;
      betDelay?: number;
      minBet?: number;
      maxBet?: number;
      maxProfit?: number;
      sortPriority?: number;
    }
  ) {
    const existing = await db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.marketId, marketId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(marketSettings)
        .set({
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.isVisible !== undefined && { isVisible: data.isVisible }),
          ...(data.suspended !== undefined && { suspended: data.suspended }),
          ...(data.betLock !== undefined && { betLock: data.betLock }),
          ...(data.betDelay !== undefined && { betDelay: data.betDelay }),
          ...(data.minBet !== undefined && { minBet: String(data.minBet) }),
          ...(data.maxBet !== undefined && { maxBet: String(data.maxBet) }),
          ...(data.maxProfit !== undefined && {
            maxProfit: String(data.maxProfit),
          }),
          ...(data.sortPriority !== undefined && {
            sortPriority: data.sortPriority,
          }),
          ...(data.marketName && { marketName: data.marketName }),
        })
        .where(eq(marketSettings.marketId, marketId));
    } else {
      await db.insert(marketSettings).values({
        marketId,
        eventId: Number(data.eventId || 0),
        marketName: data.marketName || "",
        marketType: data.marketType || "MATCH_ODDS",
        bettingType: parseMarketType(data.bettingType),
        isActive: data.isActive ?? true,
        isVisible: data.isVisible ?? true,
        suspended: data.suspended ?? false,
        betLock: data.betLock ?? false,
        betDelay: data.betDelay,
        minBet: data.minBet != null ? String(data.minBet) : undefined,
        maxBet: data.maxBet != null ? String(data.maxBet) : undefined,
        maxProfit: data.maxProfit != null ? String(data.maxProfit) : undefined,
        sortPriority: data.sortPriority ?? 0,
      });
    }

    // Sync to Redis
    const hash: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== "eventId") {
        hash[key] = String(value);
      }
    }
    if (Object.keys(hash).length > 0 && redis.isOpen) {
      await redis.hSet(`admin:market:${marketId}`, hash);
    }

    return { success: true, marketId };
  },

  // ═══════════════════════════════════════════════════════════
  //  CUSTOM MARKET CREATION
  // ═══════════════════════════════════════════════════════════

  async createCustomMarket(params: {
    eventId: string;
    marketName: string;
    bettingType: string;
    runners: {
      name: string;
      back?: { price: number; size: number }[];
      lay?: { price: number; size: number }[];
    }[];
    minBet?: number;
    maxBet?: number;
    maxProfit?: number;
    betDelay?: number;
    whitelabelId?: string;
  }) {
    // Generate a numeric marketId in Betfair-like format: "9.<eventId><timestamp>"
    // Prefix "9." distinguishes custom markets from real Betfair markets (which use "1.")
    const timestamp = Date.now();
    const marketId = `9.${params.eventId}${timestamp}`;
    try {
      // Validate: at least 1 runner
      if (!params.runners || params.runners.length === 0) {
        return { success: false, error: "At least 1 runner is required" };
      }
      // Validate: max 3 back and 3 lay per runner
      for (const r of params.runners) {
        if (r.back && r.back.length > 3) {
          return { success: false, error: "Max 3 back prices per runner" };
        }
        if (r.lay && r.lay.length > 3) {
          return { success: false, error: "Max 3 lay prices per runner" };
        }
      }

      // Insert market to DB
      await db.insert(marketSettings).values({
        marketId,
        eventId: Number(params.eventId),
        marketName: params.marketName,
        marketType: "CUSTOM",
        bettingType: parseMarketType(params.bettingType),
        provider: "CUSTOM",
        whitelabelId: params.whitelabelId || undefined,
        isCustom: true,
        isActive: true,
        isVisible: true,
        suspended: false,
        betDelay: params.betDelay ?? 0,
        minBet: params.minBet != null ? String(params.minBet) : "100",
        maxBet: params.maxBet != null ? String(params.maxBet) : "50000",
        maxProfit: params.maxProfit != null ? String(params.maxProfit) : "100000",
      });

      // Insert runners to DB + set custom odds in Redis
      for (let i = 0; i < params.runners.length; i++) {
        const r = params.runners[i];
        // Generate numeric selectionId: timestamp * 100 + runner index (unique per ms)
        const selectionId = timestamp * 100 + (i + 1);
        const back = (r.back || []).slice(0, 3);
        const lay = (r.lay || []).slice(0, 3);

        await db.insert(runnerSettings).values({
          selectionId,
          marketId,
          name: r.name,
          sortPriority: i,
        });

        // Save custom odds in DB (JSONB format)
        await db.insert(customMarketOdds).values({
          marketId,
          selectionId,
          backPrices: back,
          layPrices: lay,
        });

        // Set custom odds in Redis for instant use
        if (redis.isOpen) {
          await redis.hSet(
            `custom:odds:${marketId}`,
            String(selectionId),
            buildRunnerRedisJson(r.name, back, lay)
          );
        }
      }

      // Set market overrides in Redis
      if (redis.isOpen) {
        await redis.hSet(`admin:market:${marketId}`, {
          isActive: "true",
          isVisible: "true",
          suspended: "false",
          betLock: "false",
          bettingType: params.bettingType,
          marketName: params.marketName,
          marketType: "CUSTOM",
          minBet: String(params.minBet || 100),
          maxBet: String(params.maxBet || 50000),
          maxProfit: String(params.maxProfit || 100000),
          betDelay: String(params.betDelay || 0),
        });

        // Add to event's custom market set
        await redis.sAdd(`custom:markets:${params.eventId}`, marketId);
      }

      return { success: true, marketId };
    } catch (e) {
      console.error("[AdminMarketService] createCustomMarket error:", e);
      return { success: false, error: "Failed to create custom market" };
    }
  },

  // ═══════════════════════════════════════════════════════════
  //  CUSTOM MARKET ODDS UPDATE
  // ═══════════════════════════════════════════════════════════

  async updateCustomOdds(
    marketId: string,
    selectionId: string,
    odds: {
      back?: { price: number; size: number }[];
      lay?: { price: number; size: number }[];
    }
  ) {
    // Validate max 3 each
    if (odds.back && odds.back.length > 3) {
      return { success: false, error: "Max 3 back prices per runner" };
    }
    if (odds.lay && odds.lay.length > 3) {
      return { success: false, error: "Max 3 lay prices per runner" };
    }

    // Check if exists
    const existing = await db
      .select()
      .from(customMarketOdds)
      .where(
        and(
          eq(customMarketOdds.marketId, marketId),
          eq(customMarketOdds.selectionId, Number(selectionId))
        )
      )
      .limit(1);

    const updateData: any = {};
    if (odds.back !== undefined) updateData.backPrices = odds.back;
    if (odds.lay !== undefined) updateData.layPrices = odds.lay;

    if (existing.length > 0) {
      await db
        .update(customMarketOdds)
        .set(updateData)
        .where(
          and(
            eq(customMarketOdds.marketId, marketId),
            eq(customMarketOdds.selectionId, Number(selectionId))
          )
        );
    } else {
      await db.insert(customMarketOdds).values({
        marketId,
        selectionId: Number(selectionId),
        backPrices: odds.back || [],
        layPrices: odds.lay || [],
      });
    }

    // Update Redis (instant effect on next 1s cycle)
    if (redis.isOpen) {
      const existingJson = await redis.hGet(
        `custom:odds:${marketId}`,
        selectionId
      );
      const current = existingJson ? JSON.parse(existingJson) : {};
      const updated = {
        ...current,
        back: odds.back !== undefined ? odds.back : current.back,
        lay: odds.lay !== undefined ? odds.lay : current.lay,
      };
      await redis.hSet(
        `custom:odds:${marketId}`,
        selectionId,
        JSON.stringify(updated)
      );
    }

    return { success: true };
  },

  // ═══════════════════════════════════════════════════════════
  //  GET CUSTOM MARKET WITH RUNNERS + ODDS
  // ═══════════════════════════════════════════════════════════

  async getCustomMarketDetails(marketId: string) {
    const market = await db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.marketId, marketId))
      .limit(1);

    if (market.length === 0) return null;

    const runners = await db
      .select()
      .from(runnerSettings)
      .where(eq(runnerSettings.marketId, marketId));

    const odds = await db
      .select()
      .from(customMarketOdds)
      .where(eq(customMarketOdds.marketId, marketId));

    const runnersWithOdds = runners.map((r) => {
      const runnerOdds = odds.find((o) => o.selectionId === r.selectionId);
      return {
        ...r,
        backPrices: runnerOdds?.backPrices || [],
        layPrices: runnerOdds?.layPrices || [],
      };
    });

    return { ...market[0], runners: runnersWithOdds };
  },

  // ═══════════════════════════════════════════════════════════
  //  DELETE CUSTOM MARKET
  // ═══════════════════════════════════════════════════════════

  async deleteCustomMarket(marketId: string) {
    // Get the market to find eventId
    const market = await db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.marketId, marketId))
      .limit(1);

    if (market.length === 0) return { success: false, error: "Market not found" };

    const eventId = market[0].eventId;

    // Delete from DB
    await db
      .delete(customMarketOdds)
      .where(eq(customMarketOdds.marketId, marketId));
    await db
      .delete(runnerSettings)
      .where(eq(runnerSettings.marketId, marketId));
    await db
      .delete(marketSettings)
      .where(eq(marketSettings.marketId, marketId));

    // Clean up Redis
    if (redis.isOpen) {
      await redis.del(`admin:market:${marketId}`);
      await redis.del(`custom:odds:${marketId}`);
      await redis.sRem(`custom:markets:${eventId}`, marketId);
    }

    return { success: true };
  },

  // ═══════════════════════════════════════════════════════════
  //  EVENT SEARCH
  // ═══════════════════════════════════════════════════════════

  async searchEvents(query: string, limit: number = 20) {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const sports = dummysports as { id: string; name: string }[];
    const results: {
      eventId: string;
      name: string;
      sportId: string;
      sportName: string;
      seriesName: string;
      openDate: string | null;
      inPlay: boolean;
    }[] = [];

    // Fetch series data for all sports in parallel (uses cache if available, fetches fresh otherwise)
    const allSportsData = await Promise.all(
      sports.map(async (sport) => {
        try {
          const seriesData = await SportsService.getSeriesWithMatches(sport.id);
          return { sport, seriesData: seriesData || [] };
        } catch {
          return { sport, seriesData: [] };
        }
      })
    );

    // Search through all sports data
    for (const { sport, seriesData } of allSportsData) {
      for (const series of seriesData) {
        const seriesName = series.name || "Unknown Series";
        const matches = series.matches || [];

        for (const match of matches) {
          const matchId = String(match.id || "");
          const matchName = String(match.name || "");

          // Match against event name, series name, or event ID
          if (
            matchName.toLowerCase().includes(q) ||
            seriesName.toLowerCase().includes(q) ||
            matchId.includes(q)
          ) {
            results.push({
              eventId: matchId,
              name: matchName,
              sportId: sport.id,
              sportName: sport.name,
              seriesName,
              openDate: match.openDate || null,
              inPlay: match.inPlay || false,
            });

            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    return results;
  },

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  getUserWhitelabelId,

  // ═══════════════════════════════════════════════════════════
  //  STARTUP SYNC: DB → Redis
  // ═══════════════════════════════════════════════════════════

  async syncOverridesToRedis() {
    console.log("[AdminSync] Syncing admin overrides from DB to Redis...");

    if (!redis.isOpen) {
      console.warn("[AdminSync] Redis not connected, skipping sync");
      return;
    }

    // Sync event overrides
    const allEvents = await db.select().from(events);
    for (const evt of allEvents) {
      await redis.hSet(`admin:event:${evt.eventId}`, {
        isActive: String(evt.isActive),
        isVisible: String(evt.isVisible),
        suspended: String(evt.suspended),
        betDelay: String(evt.betDelay),
      });
    }

    // Sync market overrides
    const allMarkets = await db.select().from(marketSettings);
    for (const mkt of allMarkets) {
      const hash: Record<string, string> = {
        isActive: String(mkt.isActive),
        isVisible: String(mkt.isVisible),
        suspended: String(mkt.suspended),
        betLock: String(mkt.betLock),
      };
      if (mkt.betDelay !== null) hash.betDelay = String(mkt.betDelay);
      if (mkt.minBet !== null) hash.minBet = String(mkt.minBet);
      if (mkt.maxBet !== null) hash.maxBet = String(mkt.maxBet);
      if (mkt.maxProfit !== null) hash.maxProfit = String(mkt.maxProfit);
      if (mkt.sortPriority !== null)
        hash.sortPriority = String(mkt.sortPriority);

      if (mkt.isCustom) {
        hash.marketName = mkt.marketName;
        hash.marketType = mkt.marketType;
        hash.bettingType = marketTypeToString(mkt.bettingType).toUpperCase();
      }

      await redis.hSet(`admin:market:${mkt.marketId}`, hash);

      // Rebuild custom market sets
      if (mkt.isCustom) {
        await redis.sAdd(`custom:markets:${mkt.eventId}`, mkt.marketId);
      }
    }

    // Sync custom odds (new JSONB format)
    const allCustomOdds = await db.select().from(customMarketOdds);
    for (const co of allCustomOdds) {
      // Get runner name
      const runner = await db
        .select()
        .from(runnerSettings)
        .where(
          and(
            eq(runnerSettings.marketId, co.marketId),
            eq(runnerSettings.selectionId, co.selectionId)
          )
        )
        .limit(1);

      const back = (co.backPrices as { price: number; size: number }[]) || [];
      const lay = (co.layPrices as { price: number; size: number }[]) || [];

      await redis.hSet(
        `custom:odds:${co.marketId}`,
        String(co.selectionId),
        buildRunnerRedisJson(runner[0]?.name || String(co.selectionId), back, lay)
      );
    }

    console.log(
      `[AdminSync] Synced ${allEvents.length} events, ${allMarkets.length} markets, ${allCustomOdds.length} custom odds to Redis`
    );
  },
};
