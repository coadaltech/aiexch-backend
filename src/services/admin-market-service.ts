import { redis } from "@db/redis";
import { db } from "@db/index";
import { RedisGCService } from "./redis-gc-service";

// TTL refreshed on every admin-override write. Outlives any normal match
// lifetime; renewed whenever the key is touched. Stale keys get cleaned up
// either by this TTL or by the periodic Redis GC pass.
const OVERRIDE_TTL = RedisGCService.OVERRIDE_TTL_SECONDS;
import {
  events,
  marketSettings,
  runnerSettings,
  customMarketOdds,
  users,
  transactions,
  marketResults,
} from "@db/schema";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { parseMarketType, marketTypeToString } from "../types/enums";
import { SportsService } from "./sports";
import { LiveDataService } from "./live-data-service";
import dummysports from "../dummy/sportsevents.json";

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
      const key = `admin:event:${eventId}`;
      await redis.hSet(key, hash);
      await redis.expire(key, OVERRIDE_TTL);
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
        bettingType: parseMarketType(data.bettingType, data.marketType),
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
      const key = `admin:market:${marketId}`;
      await redis.hSet(key, hash);
      await redis.expire(key, OVERRIDE_TTL);
    }

    // Push an instant patched broadcast so subscribed user pages (matchId,
    // multimarket) reflect the new min/max bet, bet delay, and toggles
    // immediately instead of waiting up to a full poll cycle.
    const resolvedEventId =
      data.eventId ||
      (existing[0]?.eventId != null ? String(existing[0].eventId) : null);
    if (resolvedEventId) {
      LiveDataService.patchMarketSettings(resolvedEventId, marketId, data);
    }

    return { success: true, marketId };
  },

  /**
   * Set (or clear) the user-facing notice/remark on a market. The notice is
   * persisted on market_settings, mirrored into the `admin:market:<id>` Redis
   * hash (so the live pipeline picks it up each tick) and instantly patched
   * into the active match broadcast so subscribed user pages show it right
   * away. Pass an empty/whitespace notice to clear it.
   */
  async updateMarketNotice(
    marketId: string,
    notice: string,
    eventId?: string
  ) {
    const clean = (notice ?? "").trim().slice(0, 500);

    const existing = await db
      .select()
      .from(marketSettings)
      .where(eq(marketSettings.marketId, marketId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(marketSettings)
        .set({ notice: clean || null })
        .where(eq(marketSettings.marketId, marketId));
    } else {
      // No settings row yet (API-fed market). Create a minimal row so the
      // notice survives — eventId is required to scope it.
      const resolvedEventId = Number(eventId || 0);
      await db.insert(marketSettings).values({
        marketId,
        eventId: resolvedEventId,
        marketName: "",
        marketType: "MATCH_ODDS",
        notice: clean || null,
      });
    }

    const resolvedEventId =
      eventId ||
      (existing[0]?.eventId != null ? String(existing[0].eventId) : null);

    // Mirror into Redis so the pipeline merge surfaces it on every tick.
    if (redis.isOpen) {
      const key = `admin:market:${marketId}`;
      if (clean) {
        await redis.hSet(key, "notice", clean);
      } else {
        await redis.hDel(key, "notice");
      }
      await redis.expire(key, OVERRIDE_TTL);
    }

    // Instant push to live subscribers (no-op if event isn't live).
    if (resolvedEventId) {
      LiveDataService.patchMarketSettings(resolvedEventId, marketId, {
        notice: clean,
      });
    }

    return { success: true, marketId, notice: clean };
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
    const timestamp = Date.now();
    const marketId = `9.${params.eventId}${timestamp}`;

    if (!params.runners || params.runners.length === 0) {
      return { success: false, error: "At least 1 runner is required" };
    }

    try {
      await db.insert(marketSettings).values({
        marketId,
        eventId: Number(params.eventId),
        marketName: params.marketName,
        marketType: "CUSTOM",
        bettingType: parseMarketType(params.bettingType, "CUSTOM"),
        provider: "CUSTOM",
        whitelabelId: params.whitelabelId || undefined,
        isCustom: true,
        isActive: true,
        isVisible: true,
        suspended: false,
        betDelay: params.betDelay ?? 0,
        minBet: params.minBet != null ? String(params.minBet) : "100",
        maxBet: params.maxBet != null ? String(params.maxBet) : "50000",
        maxProfit:
          params.maxProfit != null ? String(params.maxProfit) : "100000",
      });

      // One DB row per runner, one DB row per runner's odds.
      // selectionId = 1, 2, 3... scoped by marketId.
      for (let i = 0; i < params.runners.length; i++) {
        const r = params.runners[i];
        const selectionId = i + 1;
        const back = (r.back || []).slice(0, 3);
        const lay = (r.lay || []).slice(0, 3);

        await db.insert(runnerSettings).values({
          selectionId,
          marketId,
          name: r.name,
          sortPriority: i,
        });

        await db.insert(customMarketOdds).values({
          marketId,
          selectionId,
          backPrices: back,
          layPrices: lay,
        });
      }

      if (redis.isOpen) {
        // Clear any prior state for this marketId (paranoia — fresh create
        // should never collide, but leaves no ambiguity if it did).
        await redis.del(`custom:ballrunning:${marketId}`);

        const marketKey = `admin:market:${marketId}`;
        await redis.hSet(marketKey, {
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
        await redis.expire(marketKey, OVERRIDE_TTL);
        const customSetKey = `custom:markets:${params.eventId}`;
        await redis.sAdd(customSetKey, marketId);
        await redis.expire(customSetKey, OVERRIDE_TTL);
      }

      return { success: true, marketId };
    } catch (e) {
      console.error("[createCustomMarket] error:", e);
      return { success: false, error: "Failed to create custom market" };
    }
  },

  // ═══════════════════════════════════════════════════════════
  //  CUSTOM MARKET ODDS UPDATE
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle a custom market's "ball running" flag. This is MARKET-level: it
   * sets `admin:market:<marketId>.ballRunning = "true"/"false"` in Redis.
   * The pipeline reads the flag and emits `sportingEvent: true` on the
   * market so the frontend draws the striped "Ball Running" overlay on top
   * of every runner (prices stay visible underneath).
   */
  async setCustomMarketBallRunning(marketId: string, ballRunning: boolean) {
    if (!redis.isOpen) return { success: true };
    const key = `admin:market:${marketId}`;
    await redis.hSet(key, "ballRunning", ballRunning ? "true" : "false");
    await redis.expire(key, OVERRIDE_TTL);

    // Push an immediate patched broadcast so subscribed user match pages flip
    // the Ball Running overlay on the next frame instead of waiting for the
    // next poll tick (the poll has to await the external getOdds call which
    // typically adds 1–2s of latency).
    try {
      const rows = await db
        .select({ eventId: marketSettings.eventId })
        .from(marketSettings)
        .where(eq(marketSettings.marketId, marketId))
        .limit(1);
      const eventId = rows[0]?.eventId;
      if (eventId != null) {
        LiveDataService.patchMarketBallRunning(
          String(eventId),
          marketId,
          ballRunning
        );
      }
    } catch (e) {
      console.warn(
        "[setCustomMarketBallRunning] instant broadcast skipped:",
        (e as Error)?.message
      );
    }

    return { success: true };
  },

  async updateCustomOdds(
    marketId: string,
    selectionId: string,
    odds: {
      back?: { price: number; size: number; line?: number }[];
      lay?: { price: number; size: number; line?: number }[];
      ballRunning?: boolean;
    }
  ) {
    if (odds.back && odds.back.length > 3) {
      return { success: false, error: "Max 3 back prices per runner" };
    }
    if (odds.lay && odds.lay.length > 3) {
      return { success: false, error: "Max 3 lay prices per runner" };
    }

    const sid = Number(selectionId);
    if (!Number.isFinite(sid)) {
      return { success: false, error: "Invalid selectionId" };
    }

    // Update the prices for this single runner only.
    const updateData: any = {};
    if (odds.back !== undefined) updateData.backPrices = odds.back;
    if (odds.lay !== undefined) updateData.layPrices = odds.lay;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(customMarketOdds)
        .set(updateData)
        .where(
          and(
            eq(customMarketOdds.marketId, marketId),
            eq(customMarketOdds.selectionId, sid)
          )
        );
    }

    // Per-runner ball-running flag (Redis only, keyed by selectionId).
    if (redis.isOpen && odds.ballRunning !== undefined) {
      const key = `custom:ballrunning:${marketId}`;
      if (odds.ballRunning) {
        await redis.hSet(key, String(sid), "true");
        await redis.expire(key, OVERRIDE_TTL);
      } else {
        await redis.hDel(key, String(sid));
      }
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
    runners.sort((a, b) => (a.sortPriority ?? 0) - (b.sortPriority ?? 0));

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

    // Block deletion when the market already has bets/related data.
    const existingBet = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.marketId, marketId))
      .limit(1);
    if (existingBet.length > 0) {
      return {
        success: false,
        error: "Cannot delete: this market has bets or related data",
      };
    }

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
      await redis.del(`custom:ballrunning:${marketId}`);
      await redis.sRem(`custom:markets:${eventId}`, marketId);
    }

    return { success: true };
  },

  // ═══════════════════════════════════════════════════════════
  //  LIST CUSTOM MARKETS (with search & filters)
  // ═══════════════════════════════════════════════════════════

  async listCustomMarkets(params: {
    search?: string;
    status?: "active" | "inactive" | "all";
    limit?: number;
    offset?: number;
  }) {
    const conditions = [eq(marketSettings.isCustom, true)];

    if (params.status === "active") {
      conditions.push(eq(marketSettings.isActive, true));
    } else if (params.status === "inactive") {
      conditions.push(eq(marketSettings.isActive, false));
    }

    const limit = Math.min(params.limit || 50, 200);
    const offset = params.offset || 0;

    // Base query for custom markets
    let query = db
      .select()
      .from(marketSettings)
      .where(and(...conditions))
      .orderBy(desc(marketSettings.addedDate))
      .limit(limit)
      .offset(offset);

    let markets = await query;

    // If search query provided, also search by event name and runner names
    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();

      // Get all custom markets with their event names and runner names
      const allCustomMarkets = await db
        .select()
        .from(marketSettings)
        .where(and(...conditions))
        .orderBy(desc(marketSettings.addedDate));

      // Get event names for these markets
      const eventIds = [...new Set(allCustomMarkets.map((m) => m.eventId))];
      const eventRows =
        eventIds.length > 0
          ? await db
              .select({ eventId: events.eventId, name: events.name })
              .from(events)
              .where(
                or(...eventIds.map((eid) => eq(events.eventId, eid)))
              )
          : [];
      const eventNameMap = new Map(
        eventRows.map((e) => [e.eventId, e.name])
      );

      // Get runner names for these markets
      const marketIds = allCustomMarkets.map((m) => m.marketId);
      const runners =
        marketIds.length > 0
          ? await db
              .select({
                marketId: runnerSettings.marketId,
                name: runnerSettings.name,
              })
              .from(runnerSettings)
              .where(
                or(
                  ...marketIds.map((mid) => eq(runnerSettings.marketId, mid))
                )
              )
          : [];
      const runnerNameMap = new Map<string, string[]>();
      for (const r of runners) {
        const existing = runnerNameMap.get(r.marketId) || [];
        existing.push(r.name);
        runnerNameMap.set(r.marketId, existing);
      }

      // Filter by search across market name, event name, runner names, event ID
      const filtered = allCustomMarkets.filter((m) => {
        const marketName = m.marketName.toLowerCase();
        const eventName = (eventNameMap.get(m.eventId) || "").toLowerCase();
        const runnerNames = (runnerNameMap.get(m.marketId) || [])
          .join(" ")
          .toLowerCase();
        const eventIdStr = String(m.eventId);

        return (
          marketName.includes(q) ||
          eventName.includes(q) ||
          runnerNames.includes(q) ||
          eventIdStr.includes(q)
        );
      });

      markets = filtered.slice(offset, offset + limit);
    }

    // Exclude markets whose results have already been declared. Once a result
    // is declared the market is effectively closed and should not appear on
    // the custom-markets management page.
    // declare_process stored procedure writes the status in lowercase
    // ('declared') — match case-insensitively to be safe across producers.
    if (markets.length > 0) {
      const declaredRows = await db
        .select({ marketId: marketResults.marketId })
        .from(marketResults)
        .where(
          and(
            inArray(
              marketResults.marketId,
              markets.map((m) => m.marketId)
            ),
            sql`lower(${marketResults.status}) = 'declared'`
          )
        );
      const declaredSet = new Set(declaredRows.map((r) => String(r.marketId)));
      if (declaredSet.size > 0) {
        markets = markets.filter((m) => !declaredSet.has(String(m.marketId)));
      }
    }

    // Enrich markets with event names, runners, and hasBets flag.
    const enrichedMarkets = await Promise.all(
      markets.map(async (m) => {
        const eventRow = await db
          .select({ name: events.name })
          .from(events)
          .where(eq(events.eventId, m.eventId))
          .limit(1);

        const runners = await db
          .select()
          .from(runnerSettings)
          .where(eq(runnerSettings.marketId, m.marketId));

        const betRow = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.marketId, m.marketId))
          .limit(1);

        return {
          ...m,
          eventName: eventRow[0]?.name || `Event ${m.eventId}`,
          runners,
          hasBets: betRow.length > 0,
        };
      })
    );

    return enrichedMarkets;
  },

  // ═══════════════════════════════════════════════════════════
  //  UPDATE CUSTOM MARKET DETAILS
  // ═══════════════════════════════════════════════════════════

  async updateCustomMarketDetails(
    marketId: string,
    data: {
      marketName?: string;
      bettingType?: string;
      minBet?: number;
      maxBet?: number;
      betDelay?: number;
      isActive?: boolean;
      runners?: { selectionId?: number; name: string }[];
    }
  ) {
    // Check market exists and is custom
    const market = await db
      .select()
      .from(marketSettings)
      .where(
        and(
          eq(marketSettings.marketId, marketId),
          eq(marketSettings.isCustom, true)
        )
      )
      .limit(1);

    if (market.length === 0) {
      return { success: false, error: "Custom market not found" };
    }

    // Update market settings
    const updateFields: any = {};
    if (data.marketName !== undefined) updateFields.marketName = data.marketName;
    if (data.bettingType !== undefined)
      updateFields.bettingType = parseMarketType(data.bettingType, "CUSTOM");
    if (data.minBet !== undefined) updateFields.minBet = String(data.minBet);
    if (data.maxBet !== undefined) updateFields.maxBet = String(data.maxBet);
    if (data.betDelay !== undefined) updateFields.betDelay = data.betDelay;
    if (data.isActive !== undefined) updateFields.isActive = data.isActive;

    if (Object.keys(updateFields).length > 0) {
      await db
        .update(marketSettings)
        .set(updateFields)
        .where(eq(marketSettings.marketId, marketId));
    }

    // Update runner names if provided
    if (data.runners) {
      for (const runner of data.runners) {
        if (runner.selectionId) {
          await db
            .update(runnerSettings)
            .set({ name: runner.name })
            .where(
              and(
                eq(runnerSettings.marketId, marketId),
                eq(runnerSettings.selectionId, runner.selectionId)
              )
            );

          // Update runner name in Redis too
          if (redis.isOpen) {
            const existingJson = await redis.hGet(
              `custom:odds:${marketId}`,
              String(runner.selectionId)
            );
            if (existingJson) {
              const current = JSON.parse(existingJson);
              current.name = runner.name;
              const oddsKey = `custom:odds:${marketId}`;
              await redis.hSet(
                oddsKey,
                String(runner.selectionId),
                JSON.stringify(current)
              );
              await redis.expire(oddsKey, OVERRIDE_TTL);
            }
          }
        }
      }
    }

    // Sync updated fields to Redis
    if (redis.isOpen) {
      const hash: Record<string, string> = {};
      if (data.marketName) hash.marketName = data.marketName;
      if (data.bettingType) hash.bettingType = data.bettingType;
      if (data.minBet !== undefined) hash.minBet = String(data.minBet);
      if (data.maxBet !== undefined) hash.maxBet = String(data.maxBet);
      if (data.betDelay !== undefined) hash.betDelay = String(data.betDelay);
      if (data.isActive !== undefined) hash.isActive = String(data.isActive);

      if (Object.keys(hash).length > 0) {
        const key = `admin:market:${marketId}`;
        await redis.hSet(key, hash);
        await redis.expire(key, OVERRIDE_TTL);
      }
    }

    return { success: true, marketId };
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

    // Sync event overrides — skip events whose openDate is well past, those
    // would only re-bloat Redis at startup. The GC service would just delete
    // them on its next pass anyway.
    const staleCutoff = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000
    );
    const allEvents = await db.select().from(events);
    let skippedEvents = 0;
    for (const evt of allEvents) {
      if (evt.openDate && new Date(evt.openDate) < staleCutoff) {
        skippedEvents++;
        continue;
      }
      const key = `admin:event:${evt.eventId}`;
      await redis.hSet(key, {
        isActive: String(evt.isActive),
        isVisible: String(evt.isVisible),
        suspended: String(evt.suspended),
        betDelay: String(evt.betDelay),
      });
      await redis.expire(key, OVERRIDE_TTL);
    }

    // Sync market overrides — skip markets whose parent event is stale.
    const liveEventIds = new Set(
      allEvents
        .filter((e) => !e.openDate || new Date(e.openDate) >= staleCutoff)
        .map((e) => e.eventId)
    );
    const allMarkets = await db.select().from(marketSettings);
    let skippedMarkets = 0;
    for (const mkt of allMarkets) {
      if (!liveEventIds.has(mkt.eventId)) {
        skippedMarkets++;
        continue;
      }
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
      if (mkt.notice) hash.notice = mkt.notice;

      if (mkt.isCustom) {
        hash.marketName = mkt.marketName;
        hash.marketType = mkt.marketType;
        hash.bettingType = marketTypeToString(mkt.bettingType).toUpperCase();
      }

      const marketKey = `admin:market:${mkt.marketId}`;
      await redis.hSet(marketKey, hash);
      await redis.expire(marketKey, OVERRIDE_TTL);

      // Rebuild custom market sets
      if (mkt.isCustom) {
        const setKey = `custom:markets:${mkt.eventId}`;
        await redis.sAdd(setKey, mkt.marketId);
        await redis.expire(setKey, OVERRIDE_TTL);
      }
    }

    // Custom market odds live in the DB only (pipeline reads them fresh
    // each tick). No Redis hash to sync.

    console.log(
      `[AdminSync] Synced ${allEvents.length - skippedEvents}/${allEvents.length} events, ${allMarkets.length - skippedMarkets}/${allMarkets.length} markets (skipped stale)`
    );
  },
};
