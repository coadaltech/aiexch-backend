import axios from "axios";
import { BookmakerItem, FancyMarket, Odds } from "../types/sports/live-data";
import {
  BookmakerMarket,
  MarketItem,
  MatchItem,
  Score,
  ScoreMatches,
} from "../types/sports/lists";
import { MatchResult } from "../types/sports/results";
import { CacheService } from "./cache";
import { and, eq, sql } from "drizzle-orm";
import { competitions, competitionWhitelabelOverrides, events, eventWhitelabelOverrides } from "@db/schema";
import { db } from "@db/index";
import { BetfairService } from "./betfair";
import { readNotepad, writeNotepad } from "./notepad";
import { whitelabelNotepadKey, seriesNotepadPath } from "./notepad-builder";
import { redis } from "@db/redis";

const api = axios.create({
  baseURL: process.env.SPORTS_GAME_PROVIDER_BASE_URL || "http://100.30.62.142",
  timeout: 3000, // 3s timeout — for real-time polling, better to skip a tick than block
});

function validateArray<T>(data: unknown, defaultValue: T[] = []): T[] {
  return Array.isArray(data) ? data : defaultValue;
}

// Betfair market IDs use the "1.xxx" prefix; the current provider's fancy/session
// markets do not. We use this to route both market structure and odds per provider.
const isBetfairMarketId = (id: string | number): boolean =>
  String(id).startsWith("1.");

// Sports whose markets come ENTIRELY from Betfair — the legacy aggregator has
// nothing for them, so we skip it (no point paying its round-trip / timeout).
// Racing (Horse 7 / Greyhound 4339) is Betfair-only.
const BETFAIR_ONLY_EVENT_TYPES = new Set(["7", "4339"]);

// Deduplication: if getSeriesWithMatches is already running for an eventTypeId,
// subsequent calls will wait for the same promise instead of firing new DB/Redis/API calls
const inFlightSeriesFetches = new Map<string, Promise<any[]>>();

// Same dedupe idea for the flat matches-list endpoint.
const inFlightMatchesListFetches = new Map<string, Promise<any[]>>();

export const SportsService = {
  async getSeriesWithMatches(
    eventTypeId: string,
    whitelabelId?: string,
    whitelabelName?: string,
  ): Promise<any[]> {
    // Deduplication — if this eventTypeId+whitelabel is already being fetched, reuse the promise
    const dedupeKey = whitelabelId ? `${eventTypeId}:${whitelabelId}` : eventTypeId;
    const existing = inFlightSeriesFetches.get(dedupeKey);
    if (existing) {
      return existing;
    }

    const promise = this._fetchSeriesWithMatches(eventTypeId, whitelabelId, whitelabelName);
    inFlightSeriesFetches.set(dedupeKey, promise);

    try {
      return await promise;
    } finally {
      inFlightSeriesFetches.delete(dedupeKey);
    }
  },

  // Flat match list powering the homepage CricketMatchesList (and its football/
  // tennis/etc. twins). Returns [{id, name, openDate, status, inPlay,
  // defaultMarketId, seriesId, seriesName, betCount}]. Odds are NOT included —
  // the client streams them over /ws/markets.
  //
  // betCount is user-scoped (the current user's matched bet count on each
  // match), so the cache key includes userId. Anonymous callers share a single
  // cache entry keyed by "anon".
  async getMatchesWithDefaultMarkets(
    eventTypeId: string,
    whitelabelId?: string,
    userId?: string,
  ): Promise<any[]> {
    const userKey = userId ?? "anon";
    const dedupeKey = whitelabelId
      ? `${eventTypeId}:${whitelabelId}:${userKey}`
      : `${eventTypeId}::${userKey}`;
    const existing = inFlightMatchesListFetches.get(dedupeKey);
    if (existing) return existing;

    const promise = this._fetchMatchesWithDefaultMarkets(eventTypeId, whitelabelId, userId);
    inFlightMatchesListFetches.set(dedupeKey, promise);
    try {
      return await promise;
    } finally {
      inFlightMatchesListFetches.delete(dedupeKey);
    }
  },

  async _fetchMatchesWithDefaultMarkets(
    eventTypeId: string,
    whitelabelId?: string,
    userId?: string,
  ): Promise<any[]> {
    const userKey = userId ?? "anon";
    const cacheKey = whitelabelId
      ? `sports:matchesList:${eventTypeId}:${whitelabelId}:${userKey}`
      : `sports:matchesList:${eventTypeId}::${userKey}`;

    try {
      const cached = await CacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      const sportIdNum = Number(eventTypeId);
      if (!Number.isFinite(sportIdNum)) {
        console.warn(`[MatchesList] Invalid eventTypeId: ${eventTypeId}`);
        return [];
      }

      const runQuery = () => db.execute(sql`
        SELECT fn_get_matches_with_default_markets(
          ${sportIdNum}::bigint,
          ${whitelabelId ?? null}::uuid,
          ${userId ?? null}::uuid
        ) AS data
      `);

      let rows: any;
      try {
        rows = await runQuery();
      } catch (err) {
        console.warn(`[MatchesList] DB call failed for sport ${eventTypeId}, retrying in 3s...`, err);
        await new Promise(r => setTimeout(r, 3000));
        rows = await runQuery();
      }

      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const result: any[] = (rowArray[0]?.data as any[] | null) ?? [];

      // Short TTL — betCount needs to reflect new bets quickly.
      await CacheService.set(cacheKey, result, 15);
      return result;
    } catch (error) {
      console.error(`[MatchesList] Failed for ${eventTypeId}:`, error);
      return [];
    }
  },

  async _fetchSeriesWithMatches(
    eventTypeId: string,
    whitelabelId?: string,
    whitelabelName?: string,
  ): Promise<any[]> {
    const cacheKey = whitelabelId
      ? `sports:seriesWithMatches:${eventTypeId}:${whitelabelId}`
      : `sports:seriesWithMatches:${eventTypeId}`;

    try {
      // Step 0: Fast path — serve from the notepad file (regenerated on sync /
      // owner edit) at series/<whitelabel>/<sportId>. Folder = readable whitelabel
      // name (or "global"); filtering is still keyed by whitelabel id.
      const npKey = whitelabelId ? whitelabelNotepadKey(whitelabelName) : "global";
      const np = await readNotepad<any[]>(seriesNotepadPath(npKey, eventTypeId));
      if (np?.data) return np.data;

      // Step 1: MAIN CACHE CHECK
      const mainCachedData = await CacheService.get<any[]>(cacheKey);
      if (mainCachedData) {
        return mainCachedData;
      }

      // Step 2: Fetch the whole tree (competitions + events, whitelabel-filtered)
      // in a single DB round trip via the SQL function fn_get_series_with_matches.
      // Replaces the old 1 + N query pattern (getSeriesList + per-series getEventsFromDb).
      const sportIdNum = Number(eventTypeId);
      if (!Number.isFinite(sportIdNum)) {
        console.warn(`[Series] Invalid eventTypeId: ${eventTypeId}`);
        return [];
      }

      const runQuery = () => db.execute(sql`
        SELECT fn_get_series_with_matches(
          ${sportIdNum}::bigint,
          ${whitelabelId ?? null}::uuid
        ) AS data
      `);

      let rows: any;
      try {
        rows = await runQuery();
      } catch (err) {
        console.warn(`[Series] DB call failed for sport ${eventTypeId}, retrying in 3s...`, err);
        await new Promise(r => setTimeout(r, 3000));
        rows = await runQuery();
      }

      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const allSeriesResults: any[] = (rowArray[0]?.data as any[] | null) ?? [];

      if (allSeriesResults.length === 0) {
        console.log(`[Series] No series found for eventType ${eventTypeId}`);
        return [];
      }

      console.log(`[Series] Got ${allSeriesResults.length} series with events for eventType ${eventTypeId}`);

      // Cache final result
      await CacheService.set(cacheKey, allSeriesResults, 45);
      return allSeriesResults;
    } catch (error) {
      console.error(`[Series] Failed to fetch series with matches for ${eventTypeId}:`, error);
      return [];
    }
  },
  // Live odds, routed per provider by marketId:
  //   - "1.xxx" ids  → Betfair listMarketBook (mapped to the same odds shape)
  //   - everything else (fancy/session) → current provider /sports/books
  // Both return an object keyed by marketId; merged into one.
  async getOdds({
    marketId,
  }: {
    marketId: string | string[];
  }): Promise<Record<string, any>> {
    const marketIdArray = Array.isArray(marketId) ? marketId : [marketId];

    const betfairIds = marketIdArray.filter((id) => isBetfairMarketId(id));
    const currentIds = marketIdArray.filter((id) => !isBetfairMarketId(id));

    const [betfairOdds, currentOdds] = await Promise.all([
      betfairIds.length
        ? BetfairService.getOddsForMarketIds(betfairIds.map(String))
        : Promise.resolve({} as Record<string, any>),
      this._getCurrentProviderOdds(currentIds.map(String)),
    ]);

    return { ...currentOdds, ...betfairOdds };
  },

  // Current provider odds (/sports/books), chunked 30 per request as before.
  async _getCurrentProviderOdds(
    marketIdArray: string[],
  ): Promise<Record<string, any>> {
    if (!marketIdArray.length) return {};

    const chunks: string[][] = [];
    for (let i = 0; i < marketIdArray.length; i += 30) {
      chunks.push(marketIdArray.slice(i, i + 30));
    }

    try {
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const marketIds = chunk.join(",");
          const response = await api.get(`/sports/books/${marketIds}`);
          return response.data;
        }),
      );
      return Object.assign({}, ...results);
    } catch (error) {
      // getOdds failed
      return {};
    }
  },

  async getBookmarkOdds({
    eventTypeId,
    marketId,
  }: {
    eventTypeId: string;
    marketId: string | string[];
  }) {
    const marketIdArray = Array.isArray(marketId) ? marketId : [marketId];
    const chunks = [];
    for (let i = 0; i < marketIdArray.length; i += 30) {
      chunks.push(marketIdArray.slice(i, i + 30));
    }

    try {
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const marketIds = chunk.join(",");
          const response = await api.get(
            `/getBookmakerOdds?EventTypeID=${eventTypeId}&marketId=${marketIds}`,
          );
          const rawData = validateArray(response.data);
          return rawData.map((item) => {
            if (typeof item === "string") {
              try {
                return JSON.parse(item);
              } catch {
                return item;
              }
            }
            return item;
          });
        }),
      );
      return results.flat();
    } catch (error) {
      // getBookmarkOdds failed
      return [];
    }
  },

  async getBookmakers({
    eventTypeId,
    marketId,
  }: {
    eventTypeId: string;
    marketId: string | string[];
  }) {
    const marketIds = Array.isArray(marketId) ? marketId.join(",") : marketId;
    try {
      const response = await api.get(
        `/getBookmakerOdds?EventTypeID=${eventTypeId}&marketId=${marketIds}`,
      );
      const data = validateArray<BookmakerItem>(response.data);
      return data;
    } catch (error) {
      // getBookmakers failed
      return [];
    }
  },

  async getSessions({
    eventTypeId,
    matchId,
    gtype,
  }: {
    eventTypeId: string;
    matchId: string;
    gtype?: string;
  }) {
    try {
      const url = `/getSessions?EventTypeID=${eventTypeId}&matchId=${matchId}${gtype ? `&gtype=${gtype}` : ""
        }`;

      const response = await api.get(url);
      const rawData = validateArray(response.data);

      // Parse string data and filter sessions
      const parsedData = rawData
        .map((item) => {
          if (typeof item === "string") {
            try {
              return JSON.parse(item);
            } catch {
              return null;
            }
          }
          return item;
        })
        .filter(Boolean)
        .filter((session: any) => session.gtype === "session")
        .sort((a: any, b: any) => {
          const aSrNo = a.sr_no || 0;
          const bSrNo = b.sr_no || 0;

          if (aSrNo !== bSrNo) {
            return aSrNo - bSrNo;
          }

          const aSelectionId = a.SelectionId || 0;
          const bSelectionId = b.SelectionId || 0;

          if (aSelectionId !== bSelectionId) {
            return aSelectionId - bSelectionId;
          }

          return (a.RunnerName || "").localeCompare(b.RunnerName || "");
        });

      return parsedData;
    } catch (error) {
      // console.error("getSessions error:", error);
      return [];
    }
  },

  async getPremiumFancy({
    eventTypeId,
    matchId,
  }: {
    eventTypeId: string;
    matchId: string;
  }) {
    try {
      const response = await api.get(
        `/getPremium?EventTypeID=${eventTypeId}&matchId=${matchId}`,
      );
      const data = validateArray<FancyMarket>(response.data);
      return data;
    } catch (error) {
      // console.error("getPremiumFancy error:", error);
      return [];
    }
  },

  async getScore({
    eventTypeId,
    matchId,
  }: {
    eventTypeId: string;
    matchId: string;
  }) {
    try {
      const response = await api.get(
        `/score?EventTypeID=${eventTypeId}&matchId=${matchId}`,
      );
      return response.data && typeof response.data === "object"
        ? (response.data as Score)
        : null;
    } catch (error) {
      // console.error("getScore error:", error);
      return null;
    }
  },

  async getScoreMatchesList({ eventTypeId }: { eventTypeId: string }) {
    try {
      const response = await api.get(
        `/matches/list?EventTypeID=${eventTypeId}`,
      );
      return validateArray<ScoreMatches>(response.data);
    } catch (error) {
      // getScoreMatchesList failed
      return [];
    }
  },

  async getOddsResults({
    eventTypeId,
    marketIds,
  }: {
    eventTypeId: string;
    marketIds: string[];
  }) {
    const marketIdStr = marketIds.slice(0, 30).join(","); // Max 30 markets
    try {
      const response = await api.get(
        `/oddsResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`,
      );
      const data = validateArray<Odds>(response.data);
      return data;
    } catch (error) {
      // getOddsResults failed
      return [];
    }
  },

  async getBookmakersResults({
    eventTypeId,
    marketIds,
  }: {
    eventTypeId: string;
    marketIds: string[];
  }) {
    const marketIdStr = marketIds.slice(0, 30).join(","); // Max 30 markets
    try {
      const response = await api.get(
        `/bookmakersResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`,
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      // getBookmakersResults failed
      return [];
    }
  },

  async getSessionResults({
    eventTypeId,
    marketIds,
  }: {
    eventTypeId: string;
    marketIds: string[];
  }) {
    const marketIdStr = marketIds.slice(0, 30).join(","); // Max 30 markets
    try {
      const response = await api.get(
        `/sessionsResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`,
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      // getSessionResults failed
      return [];
    }
  },

  async getFancyResults({
    eventTypeId,
    marketIds,
  }: {
    eventTypeId: string;
    marketIds: string[];
  }) {
    const marketIdStr = marketIds.slice(0, 30).join(","); // Max 30 markets
    try {
      const response = await api.get(
        `/fancy1Results?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`,
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      // getFancyResults failed
      return [];
    }
  },

  async getSeriesList({ eventTypeId, whitelabelId }: { eventTypeId: string; whitelabelId?: string }) {
    const cacheKey = whitelabelId
      ? `series:${eventTypeId}:${whitelabelId}`
      : `series:${eventTypeId}`;
    try {
      // Try to get from cache first
      const cached = await CacheService.get<any[]>(cacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        return cached;
      }

      let activeCompetitions: any[];

      if (whitelabelId) {
        // Whitelabel-aware: get globally active competitions, exclude those overridden inactive
        const dbQuery = () => db
          .select({
            id: competitions.id,
            competition_id: competitions.competition_id,
            name: competitions.name,
            sport_id: competitions.sport_id,
            provider: competitions.provider,
            is_active: competitions.is_active,
            metadata: competitions.metadata,
            addedDate: competitions.addedDate,
            updateDate: competitions.updateDate,
            whitelabelActive: competitionWhitelabelOverrides.isActive,
          })
          .from(competitions)
          .leftJoin(
            competitionWhitelabelOverrides,
            and(
              eq(competitionWhitelabelOverrides.competitionId, competitions.competition_id),
              eq(competitionWhitelabelOverrides.whitelabelId, whitelabelId),
            ),
          )
          .where(
            and(
              eq(competitions.sport_id, Number(eventTypeId)),
              eq(competitions.is_active, true),
            )
          )
          .orderBy(competitions.name);

        try {
          const rows = await dbQuery();
          // Filter out competitions overridden to inactive for this whitelabel
          activeCompetitions = rows.filter(
            (r) => r.whitelabelActive === null || r.whitelabelActive === true,
          );
        } catch {
          console.warn(`[getSeriesList] DB query failed for sport ${eventTypeId}, retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          const rows = await dbQuery();
          activeCompetitions = rows.filter(
            (r) => r.whitelabelActive === null || r.whitelabelActive === true,
          );
        }
      } else {
        // No whitelabel: get all globally active competitions
        const dbQuery = () => db
          .select({
            id: competitions.id,
            competition_id: competitions.competition_id,
            name: competitions.name,
            sport_id: competitions.sport_id,
            provider: competitions.provider,
            is_active: competitions.is_active,
            metadata: competitions.metadata,
            addedDate: competitions.addedDate,
            updateDate: competitions.updateDate,
          })
          .from(competitions)
          .where(
            and(
              eq(competitions.sport_id, Number(eventTypeId)),
              eq(competitions.is_active, true),
            )
          )
          .orderBy(competitions.name);

        try {
          activeCompetitions = await dbQuery();
        } catch {
          console.warn(`[getSeriesList] DB query failed for sport ${eventTypeId}, retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          activeCompetitions = await dbQuery();
        }
      }

      // Transform the data to match the expected format
      const formattedData = activeCompetitions.map(comp => ({
        id: comp.competition_id,
        name: comp.name,
        sportId: comp.sport_id,
        provider: comp.provider,
        isActive: comp.is_active,
        metadata: comp.metadata,
        addedDate: comp.addedDate,
        updateDate: comp.updateDate,
        totalEvents: (comp.metadata as any)?.totalEvents || 0,
        dbId: comp.id,
      }));

      if (formattedData.length > 0) {
        await CacheService.set(cacheKey, formattedData, 5 * 60); // 5 minutes
      }

      return formattedData || [];
    } catch (error: any) {
      console.error("[Series] getSeriesList error:", (error as Error)?.message);
      return [];
    }
  },

  /**
   * Fetch events from DB for a competition, with optional whitelabel override filtering.
   * Returns events in the same shape as the old external API getMatchList response.
   */
  async getEventsFromDb({ competitionId, whitelabelId }: { competitionId: string; whitelabelId?: string }) {
    try {
      let rows: any[];

      if (whitelabelId) {
        const result = await db
          .select({
            eventId: events.eventId,
            name: events.name,
            openDate: events.openDate,
            isActive: events.isActive,
            defaultMarketId: events.defaultMarketId,
            whitelabelActive: eventWhitelabelOverrides.isActive,
          })
          .from(events)
          .leftJoin(
            eventWhitelabelOverrides,
            and(
              eq(eventWhitelabelOverrides.eventId, events.eventId),
              eq(eventWhitelabelOverrides.whitelabelId, whitelabelId),
            ),
          )
          .where(
            and(
              eq(events.competitionId, Number(competitionId)),
              eq(events.isActive, true),
            ),
          );

        // Filter out events overridden to inactive for this whitelabel
        rows = result.filter(
          (r) => r.whitelabelActive === null || r.whitelabelActive === true,
        );
      } else {
        rows = await db
          .select({
            eventId: events.eventId,
            name: events.name,
            openDate: events.openDate,
            isActive: events.isActive,
            defaultMarketId: events.defaultMarketId,
          })
          .from(events)
          .where(
            and(
              eq(events.competitionId, Number(competitionId)),
              eq(events.isActive, true),
            ),
          );
      }

      const now = new Date();
      // Transform to match the shape the frontend expects (same as old external API)
      return rows.map((r) => ({
        id: r.eventId,
        name: r.name,
        openDate: r.openDate ? r.openDate.toISOString() : null,
        status: "OPEN",
        // A match whose openDate is in the past has started and is likely in-play
        inPlay: r.openDate ? r.openDate <= now : false,
        defaultMarketId: r.defaultMarketId || null,
      }));
    } catch (error) {
      console.error(`[getEventsFromDb] Error for competition ${competitionId}:`, error);
      return [];
    }
  },

  async getMatchList({
    eventTypeId,
    competitionId,
  }: {
    eventTypeId: string;
    competitionId: string;
  }) {
    const cacheKey = `matches:${eventTypeId}:${competitionId}`;
    try {
      const cached = await CacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      // Fetch events from Betfair (listEvents). Returns [{ event: {...}, marketCount }].
      const betfairEvents = await BetfairService.listEvents(
        eventTypeId,
        competitionId,
      );
      const data: any[] = validateArray<any>(betfairEvents).map((e: any) => ({
        id: e.event?.id,
        name: e.event?.name,
        openDate: e.event?.openDate,
        countryCode: e.event?.countryCode,
        timezone: e.event?.timezone,
        marketCount: e.marketCount,
      }));

      await CacheService.set(cacheKey, data, 2 * 60); // 2 minutes
      return data;

      // ── DEPRECATED: legacy provider event fetch (100.30.62.142) ─────────────
      // const response = await api.get(`/sports/competitions/${competitionId}`);
      // const data = validateArray<any>(response.data.events);
      // await CacheService.set(cacheKey, data, 2 * 60);
      // return data;
    } catch (error: any) {
      // getMatchList failed
      return [];
    }
  },

  // Current provider (100.30.62.142) market catalogue for an event.
  // Returns ALL its markets; callers filter out the Betfair-sourced ones.
  async _getCurrentProviderMarkets({ eventId }: { eventId: string }): Promise<MarketItem[]> {
    try {
      const response = await api.get(`/sports/events/${eventId}`);
      const catalogues = Array.isArray(response.data?.catalogues)
        ? response.data.catalogues
        : [];
      return validateArray<MarketItem>(catalogues);
    } catch {
      return [];
    }
  },

  // Markets come from BOTH providers:
  //   - Betfair (listMarketCatalogue): ALL markets it offers.
  //   - Current provider: all markets EXCEPT the Betfair-sourced ones (provider
  //     "BETFAIR") — the old provider is an aggregator that also resells Betfair,
  //     and we now take those directly from Betfair to avoid duplication. Its
  //     non-Betfair markets (bookmaker/fancy/SKY/etc.) are kept and displayed as before.
  // Merged + de-duped by marketId. Cached 60s like before.
  async getMarkets({
    eventId,
    eventTypeId,
  }: {
    eventId: string;
    eventTypeId?: string;
  }): Promise<MarketItem[]> {
    const cacheKey = `markets:${eventId}`;

    try {
      const cached = await CacheService.get<MarketItem[]>(cacheKey);
      if (cached) return cached;

      const [betfairRaw, currentMarkets] = await Promise.all([
        BetfairService.listMarketCatalogue(eventId).catch(() => []),
        this._getCurrentProviderMarkets({ eventId }),
      ]);

      // Betfair: take everything it offers.
      const betfairMarkets = BetfairService.mapCatalogueToMarketItems(betfairRaw);

      // Current provider: keep everything EXCEPT its Betfair-sourced markets.
      const nonBetfairMarkets = currentMarkets.filter(
        (m) => String((m as any).provider ?? "").toUpperCase() !== "BETFAIR",
      );

      // Merge, de-duped by marketId (Betfair markets win on collision).
      const byId = new Map<string, MarketItem>();
      for (const m of nonBetfairMarkets) byId.set(String((m as any).marketId), m);
      for (const m of betfairMarkets) byId.set(String((m as any).marketId), m);
      const data = Array.from(byId.values());

      // Only cache non-empty results — don't cache empty so next poll retries
      if (data.length > 0) {
        await CacheService.set(cacheKey, data, 60);
      }
      return data;
    } catch (error) {
      // console.error("getMarkets error:", error);
      return [];
    }
  },

  async getBookmakersList({
    eventTypeId,
    eventId,
  }: {
    eventTypeId: string;
    eventId: string;
  }) {
    const cacheKey = `bookmakers:${eventTypeId}:${eventId}`;
    try {
      const cached = await CacheService.get<BookmakerMarket[]>(cacheKey);
      if (cached) return cached;

      const response = await api.get(
        `/getBookmakers?EventTypeID=${eventTypeId}&EventID=${eventId}`,
      );
      const data = validateArray<BookmakerMarket>(response.data);

      if (data.length > 0) {
        await CacheService.set(cacheKey, data, 30 * 60);
      }
      return data;
    } catch {
      // Timeouts and network errors are expected when external API is slow — don't spam logs
      return [];
    }
  },

  async getMarketsWithOdds({ eventId, eventTypeId }: { eventId: string; eventTypeId?: string }) {
    try {
      // console.log("Fetching markets for event:", eventId);

      // STEP 1: Get ALL markets
      const allMarkets = await this.getMarkets({ eventId, eventTypeId });

      if (!allMarkets || allMarkets.length === 0) {
        console.log("No markets found for event:", eventId);
        return [];
      }

      // STEP 2: Filter ONLY OPEN markets (exclude CLOSED and INACTIVE)
      const openMarkets = allMarkets.filter(market => market.status !== "CLOSED" && market.status !== "INACTIVE");

      // console.log(`Total markets: ${allMarkets.length}, Open markets: ${openMarkets.length}`);

      if (openMarkets.length === 0) {
        console.log("No OPEN markets found");
        return [];
      }

      // STEP 3: Get odds ONLY for OPEN markets
      const openMarketIds = openMarkets.map(m => m.marketId);
      const oddsObject = await this.getOdds({ marketId: openMarketIds });

      // STEP 4: SIMPLE MERGE - Add odds to each open market
      const marketsWithOdds = openMarkets.map(market => {
        const marketOdds = oddsObject[market.marketId];

        return {
          marketId: market.marketId,
          marketName: market.marketName,
          marketType: market.marketType,
          status: market.status,
          inPlay: market.inPlay,
          bettingType: market.bettingType,
          isLineMarket: (market as any).isLineMarket ?? false,
          marketCondition: market.marketCondition,
          sportingEvent: marketOdds?.sportingEvent ?? market.sportingEvent,
          runners: market.runners.map(runner => {
            // Find matching odds for this runner
            const oddsRunner = marketOdds?.runners?.find(
              (or: any) => or.selectionId === runner.id
            );

            return {
              selectionId: runner.id,
              name: runner.name,
              status: oddsRunner?.status || null,
              back: oddsRunner?.back || null,  // First back price
              lay: oddsRunner?.lay || null     // First lay price
            };
          })
        };
      });

      return marketsWithOdds;

    } catch (error) {
      console.error("getMarketsWithOdds error:", error);
      return [];
    }
  },
  async getBookmakersWithOdds({
    eventTypeId,
    eventId,
  }: {
    eventTypeId: string;
    eventId: string;
  }) {
    try {
      const markets = await this.getBookmakersList({ eventTypeId, eventId });

      if (!markets || markets.length === 0) {
        return [];
      }

      const marketIds = markets
        .map((market) => market.marketId)
        .filter(Boolean);

      if (marketIds.length === 0) {
        return markets;
      }

      const odds = await this.getBookmarkOdds({
        eventTypeId,
        marketId: marketIds,
      });

      const marketsWithOdds = markets.map((market) => {
        const marketOdds = odds.find(
          (odd) => odd && odd.marketId === market.marketId,
        );
        return {
          ...market,
          odds: marketOdds || null,
        };
      });

      return marketsWithOdds;
    } catch (error) {
      // getBookmakersWithOdds failed
      return [];
    }
  },

  async getNewMarketResult({ marketId }: { marketId: string }) {
    const resultBaseUrl = process.env.SPORTS_GAME_PROVIDER_BASE_RESULT_URL;
    const response = await axios.get(`${resultBaseUrl}/market/result/${marketId}`);
    return response.data;
  },

  async getNewMatchResults({ eventId }: { eventId: string }) {
    const markets = await this.getMarkets({ eventId });

    if (!markets || markets.length === 0) {
      console.log(`[NewResult] No markets found for event ${eventId}`);
      return [];
    }

    console.log(`[NewResult] Fetching results for ${markets.length} markets of event ${eventId}`);

    const results = await Promise.allSettled(
      markets.map(async (market: any) => {
        try {
          const result = await this.getNewMarketResult({ marketId: market.marketId });
          console.log(`[NewResult] marketId=${market.marketId} (${market.marketName}):`, JSON.stringify(result, null, 2));
          return { marketId: market.marketId, marketName: market.marketName, result };
        } catch (error: any) {
          console.error(`[NewResult] Failed for marketId=${market.marketId}:`, error?.message);
          return { marketId: market.marketId, marketName: market.marketName, result: null, error: error?.message };
        }
      })
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);
  },

  async getMatchDetails({
    eventTypeId,
    matchId,
  }: {
    eventTypeId: string;
    matchId: string;
  }) {
    const t0 = Date.now();
    try {
      const isRacingEvent = ["7", "4339"].includes(eventTypeId);

      // ── Fastest path: the pre-built event snapshot FILE (local disk) ───────
      // Checked FIRST because it's a local read (~ms) — faster than the remote
      // cloud Redis hop below. Built at boot + once a day for every TODAY event,
      // and on demand for any other event the first time it's opened. The page's
      // WebSocket refreshes live prices on top, so a slightly-stale file is fine
      // for the instant first paint.
      try {
        const snap = await readNotepad<any>(`event-snapshots/${matchId}`);
        if (snap?.data?.matchOdds?.length) {
          console.log(`[MatchDetails] event ${matchId}: served FILE snapshot (${snap.data.matchOdds.length} markets) in ${Date.now() - t0}ms`);
          return {
            matchOdds: snap.data.matchOdds,
            score: snap.data.score ?? null,
            premiumFancy: null,
            bookmakers: snap.data.bookmakers ?? null,
            sessions: snap.data.sessions ?? null,
            showLay: snap.data.showLay ?? !isRacingEvent,
          };
        }
      } catch {
        // Snapshot file missing/unreadable — fall through to the next source.
      }

      // ── Next: the live warm snapshot in Redis (fresher, but a remote hop) ──
      // The live WS loop mirrors every built frame to live:snapshot:<eventId>.
      // Used for events with no file yet (their first opener writes one below).
      try {
        if (redis?.isOpen) {
          const cached = await redis.get(`live:snapshot:${matchId}`);
          if (cached) {
            const msg = JSON.parse(cached);
            // Only serve it if it actually has markets — the live loop also
            // persists EMPTY frames; returning those would blank the page.
            if (Array.isArray(msg.matchOdds) && msg.matchOdds.length > 0) {
              console.log(`[MatchDetails] event ${matchId}: served LIVE snapshot (${msg.matchOdds.length} markets) in ${Date.now() - t0}ms`);
              return {
                matchOdds: msg.matchOdds,
                score: msg.score ?? null,
                premiumFancy: null,
                bookmakers: msg.bookmakers ?? null,
                sessions: msg.sessions ?? null,
                showLay: !isRacingEvent,
              };
            }
          }
        }
      } catch {
        // Snapshot read failed — fall through to the live fetch.
      }

      // ── No snapshot yet (e.g. a NON-today event opened for the first time) ──
      // Cold-fetch live, return it, AND write the snapshot file so the next
      // person who opens this event gets it instantly. The file is created once
      // here; future opens hit the FILE path above and never reach this branch.
      const marketOddsData = await this.getMarketsWithOdds({ eventId: matchId, eventTypeId });

      if (Array.isArray(marketOddsData) && marketOddsData.length > 0) {
        // Best-effort, fire-and-forget — never block the response on the write.
        void writeNotepad(
          `event-snapshots/${matchId}`,
          {
            matchOdds: marketOddsData,
            score: null,
            premiumFancy: null,
            bookmakers: null,
            sessions: null,
            showLay: !isRacingEvent,
          },
          { quiet: true },
        );
        console.log(`[MatchDetails] event ${matchId}: served COLD live fetch (${marketOddsData.length} markets) in ${Date.now() - t0}ms + created snapshot file`);
      } else {
        console.log(`[MatchDetails] event ${matchId}: COLD live fetch returned 0 markets in ${Date.now() - t0}ms`);
      }

      return {
        matchOdds: marketOddsData ?? null,
        score: null,
        premiumFancy: null,
        bookmakers: null,
        sessions: null,
        showLay: !isRacingEvent,
      };
    } catch (error) {
      console.error(`[MatchDetails] event ${matchId} failed:`, (error as Error)?.message);
      return {
        matchOdds: null,
        score: null,
        premiumFancy: null,
        bookmakers: null,
        sessions: null,
        showLay: false,
      };
    }
  },
};
