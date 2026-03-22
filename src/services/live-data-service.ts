// services/live-data-service.ts
// Unified demand-driven live data service.
// Manages per-event subscriber sets and polls external API only when users are watching.

import { MarketPipelineService } from "./market-pipeline-service";
import { SportsService } from "./sports";

type SendFn = (data: string) => void;

interface EventState {
  subscribers: Map<string, SendFn>; // clientId -> send function
  interval: ReturnType<typeof setInterval> | null;
  lastData: string | null; // last JSON broadcast (for dedup + new subscriber)
  eventTypeId: string;
}

const activeEvents = new Map<string, EventState>();

const POLL_INTERVAL_MS = 1000; // 1 second

export const LiveDataService = {
  subscribe(clientId: string, send: SendFn, eventId: string, eventTypeId: string) {
    let state = activeEvents.get(eventId);

    if (!state) {
      state = {
        subscribers: new Map(),
        interval: null,
        lastData: null,
        eventTypeId,
      };
      activeEvents.set(eventId, state);
    }

    state.subscribers.set(clientId, send);

    // Send last cached data immediately to new subscriber
    if (state.lastData) {
      try { send(state.lastData); } catch { /* ignore */ }
    }

    // Start polling if first subscriber
    if (!state.interval) {
      console.log(`[Live] Polling started: event=${eventId}, subscribers=${state.subscribers.size}`);
      this._poll(eventId);
      state.interval = setInterval(() => this._poll(eventId), POLL_INTERVAL_MS);
    }
  },

  unsubscribe(clientId: string, eventId: string) {
    const state = activeEvents.get(eventId);
    if (!state) return;

    state.subscribers.delete(clientId);

    if (state.subscribers.size === 0) {
      console.log(`[Live] Polling stopped: event=${eventId}`);
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
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

  async _poll(eventId: string) {
    const state = activeEvents.get(eventId);
    if (!state || state.subscribers.size === 0) return;

    try {
      const eventTypeId = state.eventTypeId;

      // Fetch all live data in parallel
      const [matchOdds, bookmakers, sessions, score] = await Promise.all([
        MarketPipelineService.processEvent(eventId),
        SportsService.getBookmakersWithOdds({ eventTypeId, eventId }).catch(() => []),
        SportsService.getSessions({ eventTypeId, matchId: eventId }).catch(() => []),
        SportsService.getScore({ eventTypeId, matchId: eventId }).catch(() => null),
      ]);

      const message = JSON.stringify({
        type: "live-update",
        eventId,
        matchOdds,
        bookmakers,
        sessions,
        score,
        timestamp: Date.now(),
      });

      // Skip broadcast if data hasn't changed
      if (message === state.lastData) return;
      state.lastData = message;

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
    } catch (error) {
      console.error(`[Live] Poll error for event ${eventId}:`, (error as Error)?.message);
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
