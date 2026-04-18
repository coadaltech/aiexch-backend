// services/live-data-service.ts
// Unified demand-driven live data service.
// Manages per-event subscriber sets and polls external API only when users are watching.
//
// Performance architecture:
//   - FAST PATH (continuous loop): match odds + sessions + score — fetched in parallel,
//     broadcast immediately. Next poll starts as soon as current one finishes (no idle gap).
//   - SLOW PATH (every 2s): bookmakers only — requires 2 sequential external API calls
//     (getBookmakersList + getBookmarkOdds) so it's fetched in the background.
//   - Self-scheduling loop: no setInterval. After each poll completes, the next one starts
//     immediately (with a minimum 200ms gap to avoid hammering when APIs respond from cache).

import { MarketPipelineService } from "./market-pipeline-service";
import { SportsService } from "./sports";

type SendFn = (data: string) => void;

interface EventState {
  subscribers: Map<string, SendFn>; // clientId -> send function
  loopRunning: boolean; // whether the poll loop is active
  lastMessage: string | null; // last full JSON broadcast (for new subscriber catch-up)
  eventTypeId: string;
  // Slow-path cache (bookmakers only — the slow 2-call API)
  cachedBookmakers: any[];
  lastBookmakerFetch: number;
  isBookmakerFetching: boolean;
}

const activeEvents = new Map<string, EventState>();

const MIN_POLL_GAP_MS = 200; // minimum gap between polls (max ~5/sec when APIs respond from cache)
const BOOKMAKER_INTERVAL_MS = 2000; // bookmakers every 2 seconds

export const LiveDataService = {
  subscribe(clientId: string, send: SendFn, eventId: string, eventTypeId: string) {
    let state = activeEvents.get(eventId);

    if (!state) {
      state = {
        subscribers: new Map(),
        loopRunning: false,
        lastMessage: null,
        eventTypeId,
        cachedBookmakers: [],
        lastBookmakerFetch: 0,
        isBookmakerFetching: false,
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
      console.log(`[Live] Poll loop started: event=${eventId}, subscribers=${state.subscribers.size}`);
      state.loopRunning = true;
      this._pollLoop(eventId);
    }
  },

  unsubscribe(clientId: string, eventId: string) {
    const state = activeEvents.get(eventId);
    if (!state) return;

    state.subscribers.delete(clientId);

    if (state.subscribers.size === 0) {
      console.log(`[Live] Poll loop stopped: event=${eventId}`);
      // Loop will exit on next iteration when it sees 0 subscribers
      activeEvents.delete(eventId);
    }
  },

  cleanup(clientId: string) {
    for (const [eventId, state] of activeEvents) {
      if (state.subscribers.has(clientId)) {
        this.unsubscribe(clientId, eventId);
      }
    }
  },

  /**
   * Continuous poll loop — runs as long as subscribers exist.
   * Each iteration: fetch data → broadcast → immediately start next fetch.
   * No setInterval gap between poll completion and next poll start.
   */
  async _pollLoop(eventId: string) {
    while (true) {
      const state = activeEvents.get(eventId);
      if (!state || state.subscribers.size === 0) {
        // No more subscribers — exit loop
        if (state) state.loopRunning = false;
        return;
      }

      const start = Date.now();

      try {
        await this._poll(eventId, state);
      } catch (error) {
        console.error(`[Live] Poll error for event ${eventId}:`, (error as Error)?.message);
      }

      // Enforce minimum gap so we don't hammer APIs when they respond from cache
      const elapsed = Date.now() - start;
      if (elapsed < MIN_POLL_GAP_MS) {
        await new Promise((r) => setTimeout(r, MIN_POLL_GAP_MS - elapsed));
      }
    }
  },

  async _poll(eventId: string, state: EventState) {
    const eventTypeId = state.eventTypeId;

    // ── FAST PATH: fetch match odds + sessions + score in parallel ──
    const [matchOdds, sessions, score] = await Promise.all([
      MarketPipelineService.processEvent(eventId),
      SportsService.getSessions({ eventTypeId, matchId: eventId }).catch(() => []),
      SportsService.getScore({ eventTypeId, matchId: eventId }).catch(() => null),
    ]);

    // ── SLOW PATH: bookmakers fetched in background every 2s ──
    const now = Date.now();
    if (now - state.lastBookmakerFetch >= BOOKMAKER_INTERVAL_MS && !state.isBookmakerFetching) {
      state.lastBookmakerFetch = now;
      state.isBookmakerFetching = true;

      SportsService.getBookmakersWithOdds({ eventTypeId, eventId })
        .then((bookmakers) => {
          state.cachedBookmakers = bookmakers || [];
        })
        .catch(() => {})
        .finally(() => {
          state.isBookmakerFetching = false;
        });
    }

    // ── Build and broadcast message ──
    const message = JSON.stringify({
      type: "live-update",
      eventId,
      matchOdds,
      bookmakers: state.cachedBookmakers,
      sessions: sessions || [],
      score: score ?? null,
      timestamp: now,
    });
    state.lastMessage = message;

    // Broadcast to all subscribers, remove dead ones
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
