// services/live-data-service.ts
// Unified demand-driven live data service.
//
// Architecture:
//   FIRST LOAD (once per event):
//     - getMarkets, getEventOverrides, getMarketOverridesBatch, getCustomMarkets
//     → All stored in EventState.structure (refreshed every 60s)
//
//   EVERY TICK:
//     - getOdds: GET /sports/books/{marketIds} → ONLY external API call
//     - Merge with cached structure (CPU only, no I/O)
//     - Broadcast to subscribers
//
//   LOOP SAFETY:
//     - Each loop has a unique loopId. If a newer loop starts (e.g. after page refresh),
//       the old loop detects loopId mismatch and exits. Prevents zombie loops.
//     - Poll timeout: if getOdds hangs for >5s, the tick is skipped.

import { MarketPipelineService } from "./market-pipeline-service";
import { SportsService } from "./sports";

type SendFn = (data: string) => void;

interface MarketStructure {
  eventOverrides: {
    isActive: boolean;
    isVisible: boolean;
    suspended: boolean;
    betDelay: number;
  };
  openMarkets: any[];
  openMarketIds: string[];
  marketOverridesMap: Map<string, Record<string, string>>;
  customMarkets: any[];
}

interface EventState {
  subscribers: Map<string, SendFn>;
  loopRunning: boolean;
  activeLoopId: number; // increments on each new loop — old loops detect mismatch and exit
  lastMessage: string | null;
  eventTypeId: string;
  structure: MarketStructure | null;
  lastStructureRefresh: number;
}

const activeEvents = new Map<string, EventState>();

const MIN_POLL_GAP_MS = 200;
const STRUCTURE_REFRESH_MS = 60_000;
const POLL_TIMEOUT_MS = 5_000; // if getOdds hangs for >5s, skip the tick

export const LiveDataService = {
  subscribe(clientId: string, send: SendFn, eventId: string, eventTypeId: string) {
    let state = activeEvents.get(eventId);

    if (!state) {
      state = {
        subscribers: new Map(),
        loopRunning: false,
        activeLoopId: 0,
        lastMessage: null,
        eventTypeId,
        structure: null,
        lastStructureRefresh: 0,
      };
      activeEvents.set(eventId, state);
    }

    state.subscribers.set(clientId, send);

    // Send last cached data immediately to new subscriber
    if (state.lastMessage) {
      try { send(state.lastMessage); } catch { /* ignore */ }
    }

    // Start poll loop if not already running
    if (!state.loopRunning) {
      state.loopRunning = true;
      state.activeLoopId++;
      const loopId = state.activeLoopId;
      this._pollLoop(eventId, loopId);
    }
  },

  unsubscribe(clientId: string, eventId: string) {
    const state = activeEvents.get(eventId);
    if (!state) return;

    state.subscribers.delete(clientId);
    // Don't delete state from map here — let the loop detect 0 subscribers and exit cleanly.
    // This prevents the race condition where a new subscribe() creates a new state
    // that the old loop accidentally picks up.
  },

  cleanup(clientId: string) {
    for (const [eventId, state] of activeEvents) {
      if (state.subscribers.has(clientId)) {
        this.unsubscribe(clientId, eventId);
      }
    }
  },

  async _pollLoop(eventId: string, loopId: number) {
    while (true) {
      const state = activeEvents.get(eventId);

      // Exit conditions:
      if (!state) return;
      if (state.activeLoopId !== loopId) return; // a newer loop took over — this one is stale
      if (state.subscribers.size === 0) {
        // No subscribers — clean up and exit
        state.loopRunning = false;
        activeEvents.delete(eventId);
        return;
      }

      const start = Date.now();

      try {
        // Wrap poll in a timeout to prevent hanging on a stuck API call
        await Promise.race([
          this._poll(eventId, state),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("Poll timeout")), POLL_TIMEOUT_MS)
          ),
        ]);
      } catch (error) {
        const msg = (error as Error)?.message;
        if (msg === "Poll timeout") {
          console.warn(`[Live] Poll timeout for event ${eventId} (>${POLL_TIMEOUT_MS}ms) — skipping tick`);
        } else {
          console.error(`[Live] Poll error for event ${eventId}:`, msg);
        }
      }

      const elapsed = Date.now() - start;
      if (elapsed < MIN_POLL_GAP_MS) {
        await new Promise((r) => setTimeout(r, MIN_POLL_GAP_MS - elapsed));
      }
    }
  },

  async _refreshStructure(eventId: string, state: EventState): Promise<MarketStructure | null> {
    try {
      const [eventOverrides, allMarkets, customMarkets] = await Promise.all([
        MarketPipelineService.getEventOverrides(eventId),
        SportsService.getMarkets({ eventId }),
        MarketPipelineService.getCustomMarkets(eventId),
      ]);

      if (eventOverrides.isActive === false) {
        return { eventOverrides, openMarkets: [], openMarketIds: [], marketOverridesMap: new Map(), customMarkets: [] };
      }

      const openMarkets = (allMarkets || []).filter(
        (m: any) => m.status !== "CLOSED" && m.status !== "INACTIVE"
      );
      const openMarketIds = openMarkets.map((m: any) => m.marketId);

      const marketOverridesMap = await MarketPipelineService.getMarketOverridesBatch(openMarketIds);

      const structure: MarketStructure = {
        eventOverrides,
        openMarkets,
        openMarketIds,
        marketOverridesMap,
        customMarkets,
      };

      state.structure = structure;
      state.lastStructureRefresh = Date.now();
      return structure;
    } catch (error) {
      console.error(`[Live] Structure refresh error for ${eventId}:`, (error as Error)?.message);
      return state.structure;
    }
  },

  async _poll(eventId: string, state: EventState) {
    const now = Date.now();

    // Refresh structure on first call or every 60s
    if (!state.structure || now - state.lastStructureRefresh >= STRUCTURE_REFRESH_MS) {
      await this._refreshStructure(eventId, state);
    }

    const structure = state.structure;
    if (!structure || (structure.openMarketIds.length === 0 && structure.customMarkets.length === 0)) {
      const message = JSON.stringify({
        type: "live-update",
        eventId,
        matchOdds: [],
        bookmakers: [],
        sessions: [],
        score: null,
        timestamp: now,
      });
      state.lastMessage = message;
      this._broadcast(state, message);
      return;
    }

    // ── ONLY external API call per tick ──
    const oddsObject = structure.openMarketIds.length > 0
      ? await SportsService.getOdds({ marketId: structure.openMarketIds })
      : {};

    // ── Merge: cached structure + fresh odds (CPU only) ──
    const { eventOverrides, openMarkets, marketOverridesMap, customMarkets } = structure;

    const processedMarkets = openMarkets.map((market: any) => {
      const marketOdds = oddsObject[market.marketId];
      const overrides = marketOverridesMap.get(market.marketId);

      const defaultInactiveMarket =
        market.marketName === "Completed Match" || market.marketName === "Tied Match";
      const adminDisabled = overrides ? overrides.isActive === "false" : defaultInactiveMarket;
      const adminHidden = overrides?.isVisible === "false";

      const apiCondition = market.marketCondition || {};
      const finalCondition = {
        ...apiCondition,
        betDelay: overrides?.betDelay != null
          ? parseInt(overrides.betDelay)
          : eventOverrides.betDelay ?? apiCondition.betDelay ?? 0,
        minBet: overrides?.minBet != null ? parseFloat(overrides.minBet) : apiCondition.minBet,
        maxBet: overrides?.maxBet != null ? parseFloat(overrides.maxBet) : apiCondition.maxBet,
        maxProfit: overrides?.maxProfit != null ? parseFloat(overrides.maxProfit) : apiCondition.maxProfit,
        betLock: overrides?.betLock === "true" ? true : apiCondition.betLock,
      };

      const isSuspended =
        eventOverrides.suspended === true ||
        overrides?.suspended === "true" ||
        market.status === "SUSPENDED";

      return {
        marketId: market.marketId,
        marketName: market.marketName,
        marketType: market.marketType,
        status: isSuspended ? "SUSPENDED" : (marketOdds?.status ?? market.status),
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

    const allProcessed = customMarkets.length > 0
      ? [...processedMarkets, ...customMarkets]
      : processedMarkets;

    // Broadcast
    const message = JSON.stringify({
      type: "live-update",
      eventId,
      matchOdds: allProcessed,
      bookmakers: [],
      sessions: [],
      score: null,
      timestamp: Date.now(),
    });
    state.lastMessage = message;
    this._broadcast(state, message);

    // Fire-and-forget: update Redis live cache for bet validation
    MarketPipelineService.finalize(eventId, allProcessed);
  },

  _broadcast(state: EventState, message: string) {
    const deadClients: string[] = [];
    for (const [clientId, send] of state.subscribers) {
      try {
        send(message);
      } catch {
        deadClients.push(clientId);
      }
    }
    for (const clientId of deadClients) {
      this.cleanup(clientId);
    }
  },

  getStats() {
    const events: Record<string, number> = {};
    for (const [eventId, state] of activeEvents) {
      events[eventId] = state.subscribers.size;
    }
    return { activeEvents: activeEvents.size, events };
  },
};
