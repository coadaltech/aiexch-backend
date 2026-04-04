import { redis, redisIsHealthy } from "@db/redis";
import { SportsService } from "./sports";
import { broadcastMarketUpdate } from "./socket-service";
import crypto from "crypto";

/** Safe Redis helper — returns null/undefined instead of throwing when Redis is down */
async function safeRedisOp<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (!redisIsHealthy()) return fallback;
    return await op();
  } catch {
    return fallback;
  }
}

const SNAPSHOT_INTERVAL_MS = 10_000; // Write to history stream every 10s max per market
const lastSnapshotTime = new Map<string, number>();

export const MarketPipelineService = {
  /**
   * Called every 1 second by MarketCronService.
   * Replaces the old direct SportsService.getMarketsWithOdds() call.
   *
   * Flow:
   *  1. Check event-level admin overrides
   *  2. Fetch raw markets + odds from external API (unchanged)
   *  3. Load market-level admin overrides from Redis
   *  4. Apply overrides (isActive, isVisible, suspended, betDelay, min/max)
   *  5. Inject custom markets
   *  6. Store processed data in Redis live cache
   *  7. Push throttled odds snapshot to Redis Stream
   *  8. Broadcast to WebSocket subscribers (same format as before)
   */
  async processEvent(eventId: string): Promise<any[]> {
    try {
      // ── STEP 1: Check event-level admin overrides ──
      const eventOverrides = await this.getEventOverrides(eventId);
      if (eventOverrides.isActive === false) {
        // Event disabled by admin — broadcast empty so frontend clears UI
        broadcastMarketUpdate(eventId, {
          eventId,
          markets: [],
          timestamp: Date.now(),
        });
        return [];
      }

      // ── STEP 2: Fetch raw data from external API (same as before) ──
      const allMarkets = await SportsService.getMarkets({ eventId });

      if (!allMarkets || allMarkets.length === 0) {
        // Still check for custom markets even if no API markets
        const customMarkets = await this.getCustomMarkets(eventId);
        if (customMarkets.length > 0) {
          await this.finalize(eventId, customMarkets);
          return customMarkets;
        }
        return [];
      }

      const openMarkets = allMarkets.filter(
        (m: any) => m.status !== "CLOSED" && m.status !== "INACTIVE"
      );

      if (openMarkets.length === 0) {
        const customMarkets = await this.getCustomMarkets(eventId);
        if (customMarkets.length > 0) {
          await this.finalize(eventId, customMarkets);
          return customMarkets;
        }
        return [];
      }

      const openMarketIds = openMarkets.map((m: any) => m.marketId);
      const oddsObject = await SportsService.getOdds({ marketId: openMarketIds });

      // ── STEP 3: Load admin overrides for all markets (batched) ──
      const marketOverridesMap = await this.getMarketOverridesBatch(openMarketIds);

      // ── STEP 4: Merge API data + admin overrides ──
      // Include ALL markets (even admin-disabled) with flags so admin panel can see them
      const processedMarkets = openMarkets
        .map((market: any) => {
          const marketOdds = oddsObject[market.marketId];
          const overrides = marketOverridesMap.get(market.marketId);

          // "Completed Match" and "Tied Match" markets are inactive by default
          // — they must be explicitly enabled by an admin.
          const defaultInactiveMarket =
            market.marketName === "Completed Match" ||
            market.marketName === "Tied Match";
          const adminDisabled = overrides
            ? overrides.isActive === "false"
            : defaultInactiveMarket;
          const adminHidden = overrides?.isVisible === "false";

          // Build final marketCondition: admin overrides take priority over API
          const apiCondition = market.marketCondition || {};
          const finalCondition = {
            ...apiCondition,
            betDelay:
              overrides?.betDelay != null
                ? parseInt(overrides.betDelay)
                : eventOverrides.betDelay ?? apiCondition.betDelay ?? 0,
            minBet:
              overrides?.minBet != null
                ? parseFloat(overrides.minBet)
                : apiCondition.minBet,
            maxBet:
              overrides?.maxBet != null
                ? parseFloat(overrides.maxBet)
                : apiCondition.maxBet,
            maxProfit:
              overrides?.maxProfit != null
                ? parseFloat(overrides.maxProfit)
                : apiCondition.maxProfit,
            betLock:
              overrides?.betLock === "true" ? true : apiCondition.betLock,
          };

          // Determine suspended status
          const isSuspended =
            eventOverrides.suspended === true ||
            overrides?.suspended === "true" ||
            market.status === "SUSPENDED";

          return {
            marketId: market.marketId,
            marketName: market.marketName,
            marketType: market.marketType,
            status: isSuspended ? "SUSPENDED" : market.status,
            inPlay: market.inPlay,
            bettingType: market.bettingType,
            marketCondition: finalCondition,
            sportingEvent: marketOdds?.sportingEvent ?? market.sportingEvent,
            adminDisabled,
            adminHidden,
            runners: market.runners.map((runner: any) => {
              const oddsRunner = marketOdds?.runners?.find(
                (or: any) => or.selectionId === runner.id
              );
              return {
                selectionId: runner.id,
                name: runner.name,
                status: oddsRunner?.status || null,
                back: oddsRunner?.back || null,
                lay: oddsRunner?.lay || null,
              };
            }),
          };
        });

      // ── STEP 5: Add custom markets for this event ──
      const customMarkets = await this.getCustomMarkets(eventId);
      const allProcessed =
        customMarkets.length > 0
          ? [...processedMarkets, ...customMarkets]
          : processedMarkets;

      // ── STEP 6–8: Store, snapshot, broadcast ──
      await this.finalize(eventId, allProcessed);

      return allProcessed;
    } catch (error) {
      console.error(`[Pipeline] Error processing event ${eventId}:`, error);
      return [];
    }
  },

  /** Store in Redis live cache, push history snapshot, broadcast to WS */
  async finalize(eventId: string, markets: any[]) {
    // Store in Redis live cache + push snapshot — fire-and-forget (don't block broadcast)
    safeRedisOp(
      () => redis.setEx(`live:markets:${eventId}`, 10, JSON.stringify(markets)),
      undefined
    );
    this.pushOddsSnapshot(eventId, markets);

    // Broadcast to WebSocket (same format as before) — this is the hot path
    broadcastMarketUpdate(eventId, {
      eventId,
      markets,
      timestamp: Date.now(),
    });
  },

  // ── Helper: Get event admin overrides from Redis ──
  async getEventOverrides(
    eventId: string
  ): Promise<{
    isActive: boolean;
    isVisible: boolean;
    suspended: boolean;
    betDelay: number;
  }> {
    const defaults = {
      isActive: true,
      isVisible: true,
      suspended: false,
      betDelay: 0,
    };
    const data = await safeRedisOp(
      () => redis.hGetAll(`admin:event:${eventId}`),
      null
    );
    if (!data || Object.keys(data).length === 0) return defaults;
    return {
      isActive: data.isActive !== "false",
      isVisible: data.isVisible !== "false",
      suspended: data.suspended === "true",
      betDelay: data.betDelay ? parseInt(data.betDelay) : 0,
    };
  },

  // ── Helper: Batch-load market overrides using Redis pipeline ──
  async getMarketOverridesBatch(
    marketIds: string[]
  ): Promise<Map<string, Record<string, string>>> {
    const map = new Map<string, Record<string, string>>();
    if (marketIds.length === 0) return map;
    await safeRedisOp(async () => {
      const pipeline = redis.multi();
      for (const id of marketIds) {
        pipeline.hGetAll(`admin:market:${id}`);
      }
      const results = await pipeline.exec();
      marketIds.forEach((id, idx) => {
        const data = results[idx] as Record<string, string> | null;
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          map.set(id, data);
        }
      });
    }, undefined);
    return map;
  },

  // ── Helper: Load custom markets for an event from Redis ──
  async getCustomMarkets(eventId: string): Promise<any[]> {
    try {
      const customMarketIds = await safeRedisOp(
        () => redis.sMembers(`custom:markets:${eventId}`),
        [] as string[]
      );
      if (!customMarketIds || customMarketIds.length === 0) return [];

      const results: any[] = [];
      for (const marketId of customMarketIds) {
        const overrides = await redis.hGetAll(`admin:market:${marketId}`);
        if (!overrides) continue;

        const adminDisabled = overrides.isActive === "false";
        const adminHidden = overrides.isVisible === "false";

        const oddsData = await redis.hGetAll(`custom:odds:${marketId}`);

        // Build runners from custom odds entries
        const runners = Object.entries(oddsData).map(
          ([selectionId, oddsJson]) => {
            const odds = JSON.parse(oddsJson);
            return {
              selectionId: parseInt(selectionId) || selectionId,
              name: odds.name || selectionId,
              status: "ACTIVE",
              back: odds.back || null,
              lay: odds.lay || null,
            };
          }
        );

        results.push({
          marketId,
          marketName: overrides.marketName || "Custom Market",
          marketType: overrides.marketType || "CUSTOM",
          status: overrides.suspended === "true" ? "SUSPENDED" : "OPEN",
          inPlay: true,
          bettingType: overrides.bettingType || "ODDS",
          isCustom: true,
          adminDisabled,
          adminHidden,
          marketCondition: {
            marketId,
            betDelay: parseInt(overrides.betDelay || "0"),
            minBet: parseFloat(overrides.minBet || "100"),
            maxBet: parseFloat(overrides.maxBet || "50000"),
            maxProfit: parseFloat(overrides.maxProfit || "100000"),
            betLock: overrides.betLock === "true",
            allowUnmatchBet: false,
            potLimit: 0,
            volume: 0,
            mtp: 0,
          },
          sportingEvent: false,
          runners,
        });
      }
      return results;
    } catch {
      return [];
    }
  },

  // In-memory dedup cache: marketId -> last snapshot hash
  _lastHashCache: new Map<string, string>(),

  // ── Helper: Push odds to Redis Stream (throttled + deduped) ──
  async pushOddsSnapshot(eventId: string, markets: any[]) {
    try {
      if (!redisIsHealthy()) return;

      let wrote = false;
      for (const market of markets) {
        const marketId = market.marketId;

        // Throttle: only write every SNAPSHOT_INTERVAL_MS per market
        const lastTime = lastSnapshotTime.get(marketId) || 0;
        if (Date.now() - lastTime < SNAPSHOT_INTERVAL_MS) continue;

        // Build snapshot from first price level of each runner
        const snapshot = {
          status: market.status,
          runners: (market.runners || []).map((r: any) => ({
            selectionId: r.selectionId,
            status: r.status,
            backPrice: r.back?.[0]?.[0] ?? r.back?.[0]?.price ?? null,
            backSize: r.back?.[0]?.[1] ?? r.back?.[0]?.size ?? null,
            layPrice: r.lay?.[0]?.[0] ?? r.lay?.[0]?.price ?? null,
            laySize: r.lay?.[0]?.[1] ?? r.lay?.[0]?.size ?? null,
          })),
        };

        // Dedup: hash current odds in-memory (no Redis GET needed)
        const snapshotHash = crypto
          .createHash("md5")
          .update(JSON.stringify(snapshot))
          .digest("hex");

        if (this._lastHashCache.get(marketId) === snapshotHash) continue;

        // Write to Redis Stream with approximate trimming inline
        await redis.xAdd("stream:odds:history", "*", {
          eventId,
          marketId,
          snapshot: JSON.stringify(snapshot),
          capturedAt: new Date().toISOString(),
        });

        // Update in-memory dedup hash + timestamp
        this._lastHashCache.set(marketId, snapshotHash);
        lastSnapshotTime.set(marketId, Date.now());
        wrote = true;
      }

      // Trim stream once per cycle (not per market), keep max 10K entries
      if (wrote) {
        await redis.xTrim("stream:odds:history", "MAXLEN", 10_000);
      }
    } catch {
      // Redis down — silently skip, odds history is non-critical
    }
  },
};
