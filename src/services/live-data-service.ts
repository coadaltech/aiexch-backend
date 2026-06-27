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
import { db } from "@db/index";
import { marketSettings } from "@db/schema";
import { isNotNull, inArray } from "drizzle-orm";
import { redis } from "@db/redis";
import { RedisGCService } from "./redis-gc-service";
import { onBroadcast, publishBroadcast } from "./broadcast-bus";

const NOTICE_TTL = RedisGCService.OVERRIDE_TTL_SECONDS;

type SendFn = (data: string) => void;

// DB-sourced bet-condition override for a single market. Each field is null
// when the owner has not set an override (fall back to the API value).
interface MarketSettingsOverride {
  betDelay: number | null;
  minBet: number | null;
  maxBet: number | null;
  maxProfit: number | null;
}

interface MarketStructure {
  eventOverrides: {
    isActive: boolean;
    isVisible: boolean;
    suspended: boolean;
    betDelay: number | null;
  };
  openMarkets: any[];
  openMarketIds: string[];
  marketOverridesMap: Map<string, Record<string, string>>;
  // marketId → owner-authored notice, sourced from the DB (market_settings)
  // every structure refresh so it survives Redis override-hash eviction.
  noticeMap: Map<string, string>;
  // marketId → owner-set bet condition overrides (bet delay, min/max bet,
  // max profit), sourced from the DB the same way as noticeMap so they also
  // survive Redis override-hash eviction (GC / TTL / flush) instead of
  // silently reverting to the API-supplied defaults.
  settingsMap: Map<string, MarketSettingsOverride>;
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
  // Diagnostics: when the loop started, so we can log how long the FIRST live
  // frame took to reach subscribers (this is the "page shows a spinner" time).
  loopStartedAt: number;
  firstFrameLogged: boolean;
}

const activeEvents = new Map<string, EventState>();

const MIN_POLL_GAP_MS = 200;
const STRUCTURE_REFRESH_MS = 60_000;
const POLL_TIMEOUT_MS = 15_000; // if getOdds hangs for >15s, skip the tick

// Warm-snapshot cache. Every broadcast is mirrored to Redis so a freshly-opened
// match page (a cold event with no in-memory loop yet) can be served the last
// known snapshot instantly instead of waiting ~1–2s for the first external odds
// poll. Kept short so we never serve badly stale data — the live loop refreshes
// it within one tick of subscribing.
const SNAPSHOT_TTL_SECONDS = 120;
const snapshotKey = (eventId: string) => `live:snapshot:${eventId}`;

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
        loopStartedAt: 0,
        firstFrameLogged: false,
      };
      activeEvents.set(eventId, state);
    }

    state.subscribers.set(clientId, send);

    // Send last cached data immediately to new subscriber
    if (state.lastMessage) {
      try { send(state.lastMessage); } catch { /* ignore */ }
    } else {
      // Cold event: no in-memory snapshot yet, so the first poll has to await an
      // external odds call before anything is broadcast. Serve the Redis warm
      // snapshot (left by any recent viewer) instantly so the page paints now
      // instead of showing a loading spinner for ~1–2s. Fire-and-forget.
      void this._sendWarmSnapshot(eventId, clientId, send);
    }

    // Start poll loop if not already running
    if (!state.loopRunning) {
      state.loopRunning = true;
      state.activeLoopId++;
      state.loopStartedAt = Date.now();
      state.firstFrameLogged = false;
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

  // ── Multimarket subscription ──────────────────────────────────────────────
  // A multimarket subscriber pins specific markets across multiple events.
  // We piggyback on the existing per-event poll loop: for each unique eventId
  // in the list we register a synthetic subscriber (`${clientId}:${eventId}`)
  // whose send() filters matchOdds down to only the pinned marketIds and
  // relabels the envelope as `multimarket-update`. The client then merges
  // updates across events by eventId.
  subscribeMultimarket(
    clientId: string,
    send: SendFn,
    items: { eventId: string; marketId: string }[],
    eventTypeId: string,
  ) {
    const byEvent = new Map<string, Set<string>>();
    for (const it of items) {
      if (!it?.eventId || !it?.marketId) continue;
      if (!byEvent.has(it.eventId)) byEvent.set(it.eventId, new Set());
      byEvent.get(it.eventId)!.add(it.marketId);
    }

    for (const [eventId, allowed] of byEvent) {
      const wrappedSend: SendFn = (message) => {
        try {
          const msg = JSON.parse(message);
          if (msg.type !== "live-update" || msg.eventId !== eventId) return;
          const filtered = (msg.matchOdds || []).filter((m: any) =>
            allowed.has(m.marketId),
          );
          send(
            JSON.stringify({
              type: "multimarket-update",
              eventId,
              matchOdds: filtered,
              timestamp: msg.timestamp,
            }),
          );
        } catch {
          /* ignore */
        }
      };
      this.subscribe(`${clientId}:${eventId}`, wrappedSend, eventId, eventTypeId);
    }
  },

  unsubscribeMultimarket(clientId: string) {
    const prefix = `${clientId}:`;
    for (const [eventId, state] of activeEvents) {
      for (const cid of Array.from(state.subscribers.keys())) {
        if (cid.startsWith(prefix)) this.unsubscribe(cid, eventId);
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
        // Pass eventTypeId so Betfair-only sports (racing) skip the slow legacy
        // provider — it otherwise blocks the very first socket frame.
        SportsService.getMarkets({ eventId, eventTypeId: state.eventTypeId }),
        MarketPipelineService.getCustomMarkets(eventId),
      ]);

      if (eventOverrides.isActive === false) {
        return { eventOverrides, openMarkets: [], openMarketIds: [], marketOverridesMap: new Map(), noticeMap: new Map(), settingsMap: new Map(), customMarkets: [] };
      }

      const openMarkets = (allMarkets || []).filter(
        (m: any) => m.status !== "CLOSED" && m.status !== "INACTIVE"
      );
      const openMarketIds = openMarkets.map((m: any) => m.marketId);

      const marketOverridesMap = await MarketPipelineService.getMarketOverridesBatch(openMarketIds);

      // Owner-authored market notices live in market_settings (source of truth).
      // Load them here from the DB so they persist even after the volatile
      // admin:market:<id> Redis override hash is GC'd / evicted.
      const noticeMap = new Map<string, string>();
      const settingsMap = new Map<string, MarketSettingsOverride>();
      try {
        // Match notices by marketId membership (NOT solely by eventId): a notice
        // row can carry a wrong/0 eventId if it was first saved before the panel
        // knew the event, so keying on eventId alone would lose it. We pull every
        // row that has a notice (there are very few) and keep those whose market
        // belongs to this event's feed OR whose eventId matches.
        const eventMarketIds = new Set<string>([
          ...openMarketIds.map((id: any) => String(id)),
          ...(customMarkets || []).map((c: any) => String(c.marketId)),
        ]);
        const noticeRows = await db
          .select({
            marketId: marketSettings.marketId,
            eventId: marketSettings.eventId,
            notice: marketSettings.notice,
          })
          .from(marketSettings)
          .where(isNotNull(marketSettings.notice));
        for (const r of noticeRows) {
          if (!r.notice || !r.notice.trim()) continue;
          const mId = String(r.marketId);
          if (eventMarketIds.has(mId) || String(r.eventId) === String(eventId)) {
            noticeMap.set(mId, r.notice);
          }
        }

        // SELF-HEAL Redis from the DB: the admin:market:<id> override hash is
        // volatile (TTL + GC + flush on restart), but market_settings.notice is
        // the source of truth. If the DB has a notice that's missing from the
        // hash, write it back so every Redis-based read path (standard merge +
        // custom markets) recovers it and the notice never disappears.
        if (redis?.isOpen && noticeMap.size > 0) {
          for (const [mId, notice] of noticeMap) {
            try {
              const key = `admin:market:${mId}`;
              const current = await redis.hGet(key, "notice");
              if (current !== notice) {
                await redis.hSet(key, "notice", notice);
                await redis.expire(key, NOTICE_TTL);
              }
            } catch {
              /* per-market heal is best-effort */
            }
          }
        }

        // Bet-condition overrides (bet delay, min/max bet, max profit) follow
        // the exact same persistence story as notices: the owner panel writes
        // them to market_settings (source of truth) AND mirrors them into the
        // volatile admin:market:<id> hash. When that hash is GC'd / TTL-evicted
        // / flushed, the values would otherwise revert to the API defaults.
        // Re-source them from the DB here (keyed by marketId so a wrong/0
        // eventId on the row doesn't lose them) and self-heal Redis so every
        // read path recovers them.
        if (eventMarketIds.size > 0) {
          const settingsRows = await db
            .select({
              marketId: marketSettings.marketId,
              betDelay: marketSettings.betDelay,
              minBet: marketSettings.minBet,
              maxBet: marketSettings.maxBet,
              maxProfit: marketSettings.maxProfit,
            })
            .from(marketSettings)
            .where(inArray(marketSettings.marketId, [...eventMarketIds]));

          for (const r of settingsRows) {
            const mId = String(r.marketId);
            const override: MarketSettingsOverride = {
              betDelay: r.betDelay ?? null,
              minBet: r.minBet != null ? Number(r.minBet) : null,
              maxBet: r.maxBet != null ? Number(r.maxBet) : null,
              maxProfit: r.maxProfit != null ? Number(r.maxProfit) : null,
            };
            // Skip rows with no condition override at all.
            if (
              override.betDelay == null &&
              override.minBet == null &&
              override.maxBet == null &&
              override.maxProfit == null
            ) {
              continue;
            }
            settingsMap.set(mId, override);

            // SELF-HEAL: write any DB-set field that's missing/stale in the
            // admin:market:<id> hash so the standard merge + custom-market +
            // pipeline (bet-validation) read paths all recover it.
            if (redis?.isOpen) {
              try {
                const key = `admin:market:${mId}`;
                const current = await redis.hGetAll(key);
                const patch: Record<string, string> = {};
                if (
                  override.betDelay != null &&
                  current.betDelay !== String(override.betDelay)
                )
                  patch.betDelay = String(override.betDelay);
                if (
                  override.minBet != null &&
                  current.minBet !== String(override.minBet)
                )
                  patch.minBet = String(override.minBet);
                if (
                  override.maxBet != null &&
                  current.maxBet !== String(override.maxBet)
                )
                  patch.maxBet = String(override.maxBet);
                if (
                  override.maxProfit != null &&
                  current.maxProfit !== String(override.maxProfit)
                )
                  patch.maxProfit = String(override.maxProfit);
                if (Object.keys(patch).length > 0) {
                  await redis.hSet(key, patch);
                  await redis.expire(key, NOTICE_TTL);
                }
              } catch {
                /* per-market heal is best-effort */
              }
            }
          }
        }
      } catch {
        /* non-fatal: fall back to Redis-sourced notice / settings */
      }

      const structure: MarketStructure = {
        eventOverrides,
        openMarkets,
        openMarketIds,
        marketOverridesMap,
        noticeMap,
        settingsMap,
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

    // Refresh structure on first call or every 60s. Keeping this stable (not a
    // fast adaptive window) means the market SET only changes on a real catalogue
    // change, so markets don't add/drop between ticks.
    if (!state.structure || now - state.lastStructureRefresh >= STRUCTURE_REFRESH_MS) {
      await this._refreshStructure(eventId, state);
    }

    const structure = state.structure;
    if (!structure) {
      return;
    }

    // Refresh admin overrides every tick — these are cheap Redis HGETALL
    // reads, and they must reflect owner-panel changes (min/max bet, bet
    // delay, toggles) within a single poll cycle instead of waiting for the
    // 60s structure refresh window. The expensive external getMarkets call
    // stays cached at 60s.
    const [freshEventOverrides, freshMarketOverridesMap] = await Promise.all([
      MarketPipelineService.getEventOverrides(eventId),
      MarketPipelineService.getMarketOverridesBatch(structure.openMarketIds),
    ]);
    structure.eventOverrides = freshEventOverrides;
    structure.marketOverridesMap = freshMarketOverridesMap;

    // Custom markets are owner-controlled and must reflect create/update/delete
    // instantly on the user's match page. Fetch fresh from Redis every tick
    // (cheap: a single SMEMBERS + HGETALL per custom market) instead of using
    // the 60s-stale structure.customMarkets snapshot.
    const customMarkets = await MarketPipelineService.getCustomMarkets(eventId);

    if (structure.openMarketIds.length === 0 && customMarkets.length === 0) {
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
      this._logFirstFrame(eventId, state, 0);
      this._persistSnapshot(eventId, message);
      this._broadcast(state, message);
      return;
    }

    // ── ONLY external API call per tick ──
    const oddsObject = structure.openMarketIds.length > 0
      ? await SportsService.getOdds({ marketId: structure.openMarketIds })
      : {};

    // ── Merge: cached structure + fresh odds (CPU only) ──
    const { eventOverrides, openMarkets, marketOverridesMap } = structure;

    const processedMarkets = openMarkets.map((market: any) => {
      const marketOdds = oddsObject[market.marketId];
      const overrides = marketOverridesMap.get(market.marketId);

      const defaultInactiveMarket =
        market.marketName === "Completed Match" || market.marketName === "Tied Match";
      const adminDisabled = overrides ? overrides.isActive === "false" : defaultInactiveMarket;
      const adminHidden = overrides?.isVisible === "false";

      const apiCondition = market.marketCondition || {};
      // DB-sourced fallback so an evicted Redis hash doesn't revert the owner's
      // min/max/delay to the API defaults (mirrors the noticeMap fallback).
      const dbSettings = structure.settingsMap.get(market.marketId);
      const finalCondition = {
        ...apiCondition,
        betDelay: overrides?.betDelay != null
          ? parseInt(overrides.betDelay)
          : dbSettings?.betDelay != null
            ? dbSettings.betDelay
            : eventOverrides.betDelay ?? apiCondition.betDelay ?? 0,
        minBet: overrides?.minBet != null
          ? parseFloat(overrides.minBet)
          : dbSettings?.minBet ?? apiCondition.minBet,
        maxBet: overrides?.maxBet != null
          ? parseFloat(overrides.maxBet)
          : dbSettings?.maxBet ?? apiCondition.maxBet,
        maxProfit: overrides?.maxProfit != null
          ? parseFloat(overrides.maxProfit)
          : dbSettings?.maxProfit ?? apiCondition.maxProfit,
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
        // Betfair line/fancy flag — kept so the UI can group them ("Betfair Fancy").
        isLineMarket: market.isLineMarket ?? false,
        provider: market.provider ?? "BETFAIR",
        marketCondition: finalCondition,
        sportingEvent: marketOdds?.sportingEvent ?? market.sportingEvent,
        // Redis override wins (reflects an instant edit between refreshes);
        // otherwise fall back to the DB-sourced notice so it never disappears.
        notice: overrides?.notice || structure.noticeMap.get(market.marketId) || null,
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
    this._logFirstFrame(eventId, state, allProcessed.length);
    this._persistSnapshot(eventId, message);
    this._broadcast(state, message);

    // Fire-and-forget: update Redis live cache for bet validation
    MarketPipelineService.finalize(eventId, allProcessed);
  },

  // One-time log per loop: how long subscribe → first live frame took. This is
  // exactly the "page shows a loading spinner" duration, so it pinpoints whether
  // the delay is the external fetch (here) vs. WS connect / client render.
  _logFirstFrame(eventId: string, state: EventState, marketCount: number) {
    if (state.firstFrameLogged) return;
    state.firstFrameLogged = true;
    const ms = state.loopStartedAt ? Date.now() - state.loopStartedAt : -1;
    console.log(
      `[Live] First frame for event ${eventId} (type ${state.eventTypeId}) in ${ms}ms — ${marketCount} market(s)`,
    );
  },

  // Instant patch path for admin market settings (min/max bet, bet delay,
  // active/visible/suspended). Mutates the cached lastMessage so subscribers
  // see the change on the next frame without waiting for the next poll tick
  // (which has to await the external getOdds call, ~1–2s). Safe to call
  // fire-and-forget; no-op if the event has no live subscribers yet.
  patchMarketSettings(
    eventId: string,
    marketId: string,
    patch: {
      isActive?: boolean;
      isVisible?: boolean;
      suspended?: boolean;
      betLock?: boolean;
      betDelay?: number;
      minBet?: number;
      maxBet?: number;
      maxProfit?: number;
      notice?: string;
    }
  ) {
    // Cross-instance: the admin edit happened on one instance, but the event's
    // live subscribers may be on any/all instances. Publish so each instance
    // applies the patch to its own cached state and pushes to its own sockets.
    publishBroadcast(LIVE_BUS_TOPIC, { kind: "patch-settings", eventId, marketId, patch });
  },

  _localPatchMarketSettings(
    eventId: string,
    marketId: string,
    patch: {
      isActive?: boolean;
      isVisible?: boolean;
      suspended?: boolean;
      betLock?: boolean;
      betDelay?: number;
      minBet?: number;
      maxBet?: number;
      maxProfit?: number;
      notice?: string;
    }
  ) {
    const state = activeEvents.get(eventId);
    if (!state) return;

    // Keep the DB-sourced notice cache in sync immediately so a cleared/edited
    // notice doesn't briefly revert on the next tick (before the 60s refresh).
    if (patch.notice !== undefined && state.structure) {
      const trimmed = (patch.notice || "").trim();
      if (trimmed) state.structure.noticeMap.set(marketId, trimmed);
      else state.structure.noticeMap.delete(marketId);
    }

    // Same for the DB-sourced bet-condition cache: fold an instant min/max/delay
    // edit into settingsMap so it survives the per-tick marketOverridesMap
    // refresh even if the Redis hash is evicted before the next 60s heal.
    if (
      state.structure &&
      (patch.betDelay !== undefined ||
        patch.minBet !== undefined ||
        patch.maxBet !== undefined ||
        patch.maxProfit !== undefined)
    ) {
      const existing = state.structure.settingsMap.get(marketId) ?? {
        betDelay: null,
        minBet: null,
        maxBet: null,
        maxProfit: null,
      };
      if (patch.betDelay !== undefined) existing.betDelay = patch.betDelay;
      if (patch.minBet !== undefined) existing.minBet = patch.minBet;
      if (patch.maxBet !== undefined) existing.maxBet = patch.maxBet;
      if (patch.maxProfit !== undefined) existing.maxProfit = patch.maxProfit;
      state.structure.settingsMap.set(marketId, existing);
    }

    if (!state.lastMessage) return;
    try {
      const msg = JSON.parse(state.lastMessage);
      const list: any[] = Array.isArray(msg.matchOdds) ? msg.matchOdds : [];
      const market = list.find((m: any) => m.marketId === marketId);
      if (!market) return;

      if (patch.notice !== undefined) market.notice = patch.notice || null;
      if (patch.isActive !== undefined) market.adminDisabled = !patch.isActive;
      if (patch.isVisible !== undefined) market.adminHidden = !patch.isVisible;
      // Only force SUSPENDED on a true→suspend; un-suspending requires the
      // real odds-feed status, which the next poll will fill in.
      if (patch.suspended === true) market.status = "SUSPENDED";

      market.marketCondition = market.marketCondition || {};
      if (patch.betDelay !== undefined) market.marketCondition.betDelay = patch.betDelay;
      if (patch.minBet !== undefined) market.marketCondition.minBet = patch.minBet;
      if (patch.maxBet !== undefined) market.marketCondition.maxBet = patch.maxBet;
      if (patch.maxProfit !== undefined) market.marketCondition.maxProfit = patch.maxProfit;
      if (patch.betLock !== undefined) market.marketCondition.betLock = patch.betLock;

      msg.timestamp = Date.now();
      const patched = JSON.stringify(msg);
      state.lastMessage = patched;
      this._broadcast(state, patched);
    } catch (e) {
      console.warn(
        `[Live] patchMarketSettings failed for ${eventId}/${marketId}:`,
        (e as Error)?.message
      );
    }
  },

  // Instant patch path for admin toggles (e.g. ball-running). Mutates the
  // cached lastMessage for the event so the overlay flips on the user's
  // match page without waiting for the next full poll tick. Safe to call
  // fire-and-forget; if the event has no live subscribers (no cached
  // lastMessage yet) this is a no-op and the next normal poll will pick up
  // the Redis flag.
  patchMarketBallRunning(eventId: string, marketId: string, ballRunning: boolean) {
    publishBroadcast(LIVE_BUS_TOPIC, { kind: "patch-ball", eventId, marketId, ballRunning });
  },

  _localPatchMarketBallRunning(eventId: string, marketId: string, ballRunning: boolean) {
    const state = activeEvents.get(eventId);
    if (!state || !state.lastMessage) return;
    try {
      const msg = JSON.parse(state.lastMessage);
      const list: any[] = Array.isArray(msg.matchOdds) ? msg.matchOdds : [];
      const market = list.find((m: any) => m.marketId === marketId);
      if (!market) return;
      market.sportingEvent = ballRunning;
      msg.timestamp = Date.now();
      const patched = JSON.stringify(msg);
      state.lastMessage = patched;
      this._broadcast(state, patched);
    } catch (e) {
      console.warn(
        `[Live] patchMarketBallRunning failed for ${eventId}/${marketId}:`,
        (e as Error)?.message
      );
    }
  },

  // Notify everyone watching this event that a market's result was just
  // declared/voided. Clients use this signal to refetch settlement-dependent
  // data (open bets, market exposure, ledger, balance) so a settled bet drops
  // out of the bet slip instantly — event-driven, no client-side polling.
  // No-op if nobody is currently subscribed to the event.
  broadcastResultDeclared(eventId: string, marketId: string) {
    // Cross-instance: result declaration runs in a cron / owner action on a
    // single instance, but subscribers for this event live on every instance.
    publishBroadcast(LIVE_BUS_TOPIC, { kind: "result-declared", eventId, marketId });
  },

  _localBroadcastResultDeclared(eventId: string, marketId: string) {
    const state = activeEvents.get(eventId);
    if (!state || state.subscribers.size === 0) return;
    const message = JSON.stringify({
      type: "result-declared",
      eventId,
      marketId,
      timestamp: Date.now(),
    });
    this._broadcast(state, message);
  },

  // Mirror the latest broadcast to Redis so a future cold subscriber can be
  // served instantly. Fire-and-forget — a Redis hiccup must never stall the
  // poll loop.
  _persistSnapshot(eventId: string, message: string) {
    if (!redis?.isOpen) return;
    redis
      .set(snapshotKey(eventId), message, { EX: SNAPSHOT_TTL_SECONDS })
      .catch(() => { /* best-effort warm cache */ });
  },

  // Serve the Redis warm snapshot to a single just-subscribed client on a cold
  // event. No-op if there's nothing cached, the client already left, or a live
  // poll has meanwhile produced a fresh message (so we never overwrite newer
  // data with the cached copy).
  async _sendWarmSnapshot(eventId: string, clientId: string, send: SendFn) {
    if (!redis?.isOpen) return;
    try {
      const cached = await redis.get(snapshotKey(eventId));
      if (!cached) return;
      const state = activeEvents.get(eventId);
      if (!state || !state.subscribers.has(clientId) || state.lastMessage) return;
      state.lastMessage = cached;
      try { send(cached); } catch { /* ignore */ }
    } catch { /* best-effort warm cache */ }
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

// ─── Cross-instance relay for admin/result signals ─────────────────────────
// The public broadcastResultDeclared / patchMarketSettings / patchMarketBallRunning
// methods publish onto this topic; every instance (including the producer) then
// applies the change to its OWN cached state and pushes to its OWN subscribers.
const LIVE_BUS_TOPIC = "live-data";

onBroadcast(LIVE_BUS_TOPIC, (p: any) => {
  switch (p?.kind) {
    case "result-declared":
      LiveDataService._localBroadcastResultDeclared(p.eventId, p.marketId);
      break;
    case "patch-settings":
      LiveDataService._localPatchMarketSettings(p.eventId, p.marketId, p.patch);
      break;
    case "patch-ball":
      LiveDataService._localPatchMarketBallRunning(p.eventId, p.marketId, p.ballRunning);
      break;
  }
});
