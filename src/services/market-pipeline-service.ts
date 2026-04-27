import { redis, redisIsHealthy } from "@db/redis";
import { db } from "@db/index";
import { runnerSettings, customMarketOdds } from "@db/schema";
import { eq } from "drizzle-orm";
import { SportsService } from "./sports";
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
      // ── PHASE 1: Parallel — fetch everything that doesn't depend on each other ──
      // eventOverrides, markets, and customMarkets are all independent
      const [eventOverrides, allMarkets, customMarkets] = await Promise.all([
        this.getEventOverrides(eventId),
        SportsService.getMarkets({ eventId }),
        this.getCustomMarkets(eventId),
      ]);

      if (eventOverrides.isActive === false) {
        return [];
      }

      if (!allMarkets || allMarkets.length === 0) {
        if (customMarkets.length > 0) {
          this.finalize(eventId, customMarkets); // fire-and-forget
          return customMarkets;
        }
        return [];
      }

      const openMarkets = allMarkets.filter(
        (m: any) => m.status !== "CLOSED" && m.status !== "INACTIVE"
      );

      if (openMarkets.length === 0) {
        if (customMarkets.length > 0) {
          this.finalize(eventId, customMarkets);
          return customMarkets;
        }
        return [];
      }

      const openMarketIds = openMarkets.map((m: any) => m.marketId);

      // ── PHASE 2: Parallel — odds + admin overrides (both need marketIds from phase 1) ──
      const [oddsObject, marketOverridesMap] = await Promise.all([
        SportsService.getOdds({ marketId: openMarketIds }),
        this.getMarketOverridesBatch(openMarketIds),
      ]);

      // ── PHASE 3: Merge (CPU only, no I/O) ──
      const processedMarkets = openMarkets
        .map((market: any) => {
          const marketOdds = oddsObject[market.marketId];
          const overrides = marketOverridesMap.get(market.marketId);

          const defaultInactiveMarket =
            market.marketName === "Completed Match" ||
            market.marketName === "Tied Match";
          const adminDisabled = overrides
            ? overrides.isActive === "false"
            : defaultInactiveMarket;
          const adminHidden = overrides?.isVisible === "false";

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
            provider: market.provider ?? "BETFAIR",
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

      const allProcessed =
        customMarkets.length > 0
          ? [...processedMarkets, ...customMarkets]
          : processedMarkets;

      // ── Fire-and-forget: Redis cache + snapshot (don't block return) ──
      this.finalize(eventId, allProcessed);

      return allProcessed;
    } catch (error) {
      console.error(`[Pipeline] Error processing event ${eventId}:`, error);
      return [];
    }
  },

  /** Store in Redis live cache and push history snapshot.
   *  Broadcasting is handled by LiveDataService — no direct WS send here. */
  async finalize(eventId: string, markets: any[]) {
    // Store in Redis live cache + push snapshot — fire-and-forget (don't block)
    safeRedisOp(
      () => redis.setEx(`live:markets:${eventId}`, 10, JSON.stringify(markets)),
      undefined
    );
    this.pushOddsSnapshot(eventId, markets);
  },

  // ── Helper: Get event admin overrides from Redis ──
  // betDelay is null when no admin override is set, so consumers can fall
  // back to the API-supplied value via `??`. Returning 0 here would
  // short-circuit that chain (`0 ?? x` is `0`) and mask the real value.
  async getEventOverrides(
    eventId: string
  ): Promise<{
    isActive: boolean;
    isVisible: boolean;
    suspended: boolean;
    betDelay: number | null;
  }> {
    const defaults = {
      isActive: true,
      isVisible: true,
      suspended: false,
      betDelay: null,
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
      betDelay: data.betDelay != null && data.betDelay !== "" ? parseInt(data.betDelay) : null,
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

  // ── Helper: Load custom markets for an event from the DB ──
  // DB is source of truth: runner_settings gives the list, customMarketOdds
  // gives the prices, Redis only stores per-runner ball-running flags.
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

        const runnerRows = await db
          .select()
          .from(runnerSettings)
          .where(eq(runnerSettings.marketId, marketId));
        if (runnerRows.length === 0) continue;
        runnerRows.sort(
          (a, b) => (a.sortPriority ?? 0) - (b.sortPriority ?? 0)
        );

        const oddsRows = await db
          .select()
          .from(customMarketOdds)
          .where(eq(customMarketOdds.marketId, marketId));

        const ballRunningHash = await redis.hGetAll(
          `custom:ballrunning:${marketId}`
        );

        const runners = runnerRows.map((r) => {
          const odds = oddsRows.find((o) => o.selectionId === r.selectionId);
          const back =
            (odds?.backPrices as { price: number; size: number }[]) || [];
          const lay =
            (odds?.layPrices as { price: number; size: number }[]) || [];
          const suspended =
            ballRunningHash[String(r.selectionId)] === "true";
          return {
            selectionId: r.selectionId,
            name: r.name,
            status: suspended ? "SUSPENDED" : "ACTIVE",
            back: back.length > 0 ? back : null,
            lay: lay.length > 0 ? lay : null,
          };
        });

        results.push({
          marketId,
          marketName: overrides.marketName || "Custom Market",
          marketType: overrides.marketType || "CUSTOM",
          status: overrides.suspended === "true" ? "SUSPENDED" : "OPEN",
          inPlay: true,
          bettingType: overrides.bettingType || "ODDS",
          isCustom: true,
          adminDisabled: overrides.isActive === "false",
          adminHidden: overrides.isVisible === "false",
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
          // Market-level ball running: the owner clicked "Bowl Chalu" on the
          // manage-prices modal. The frontend's existing overlay logic turns
          // `sportingEvent: true` into a striped "Ball Running" overlay on
          // top of the runners (prices stay visible underneath).
          sportingEvent: overrides.ballRunning === "true",
          runners,
        });
      }
      return results;
    } catch (error) {
      console.error(
        "[Pipeline] getCustomMarkets error:",
        (error as Error)?.message
      );
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
