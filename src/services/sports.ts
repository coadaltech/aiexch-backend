import axios from "axios";
import { BookmakerItem, FancyMarket, Odds } from "../types/sports/live-data";
import {
  BookmakerMarket,
  CompetitionItem,
  MarketItem,
  MatchItem,
  Score,
  ScoreMatches,
  Sports,
} from "../types/sports/lists";
import { MatchResult } from "../types/sports/results";
import { CacheService } from "./cache";
import dummysports from "../dummy/sportsevents.json";
import seriesData from "../dummy/series.json";
import matchesData from "../dummy/matches.json";
import marketData from "../dummy/getMarkets.json";
import IndividualMarketData from "../dummy/getMarketByMarketId.json";
import odds from "../dummy/odds.json";
import { and, eq } from "drizzle-orm";
import { competitions } from "@db/schema";
import { db } from "@db/index";

type OddsObject = {
  [key: string]: any;
};

const api = axios.create({
  baseURL: process.env.SPORTS_GAME_PROVIDER_BASE_URL || "http://100.30.62.142",
  timeout: 10000,
});

function validateArray<T>(data: unknown, defaultValue: T[] = []): T[] {
  return Array.isArray(data) ? data : defaultValue;
}

export const SportsService = {
  async getSports() {
    try {
      const response = dummysports as Sports[];
      const data = validateArray<Sports>(response);
      return data;
    } catch (error: any) {
      console.error("getSports error:");
      return [];
    }
  },

  async getSeriesWithMatches(eventTypeId: string): Promise<any[]> {
    // Cache key for this method
    const cacheKey = `sports:seriesWithMatches:${eventTypeId}`;

    try {
      // ✅ Step 1: MAIN CACHE CHECK (First Level)
      const mainCachedData = await CacheService.get<any[]>(cacheKey);
      if (mainCachedData) {
        // console.log(`[SeriesCron] MAIN CACHE HIT for ${cacheKey}`);
        return mainCachedData;
      }

      // console.log(`[SeriesCron] MAIN CACHE MISS for ${cacheKey}`);
      // console.log(`[SeriesCron] Fetching fresh data for eventTypeId: ${eventTypeId}`);

      // ✅ Step 2: Fetch Series List
      const seriesList = await SportsService.getSeriesList({
        eventTypeId: eventTypeId,
      });

      // console.log(`[SeriesCron] Processing ${seriesList.length} series`);

      // ✅ Step 3: Process each series (with cache for individual series)
      const seriesPromises = seriesList.map(async (series: any) => {
        try {
          const seriesId = series.id || series.competition_id;
          const seriesCacheKey = `sports:seriesMatches:${eventTypeId}:${seriesId}`;

          // ✅ Step 4: SERIES-LEVEL CACHE CHECK (Second Level)
          const seriesCachedData = await CacheService.get<any[]>(seriesCacheKey);
          if (seriesCachedData) {
            // console.log(`[SeriesCron] SERIES CACHE HIT for ${seriesId}`);
            return {
              id: seriesId,
              name: series.name || series.competition?.name || "Unknown Series",
              eventTypeId: eventTypeId,
              matches: seriesCachedData,
            };
          }

          // console.log(`[SeriesCron] SERIES CACHE MISS for ${seriesId}, fetching matches...`);

          // ✅ Step 5: Fetch Matches for this series
          const matchData = await SportsService.getMatchList({
            eventTypeId: eventTypeId,
            competitionId: seriesId,
          });

          let matches = [];
          if (matchData && Array.isArray(matchData)) {
            matches = matchData;
          }

          // ✅ Step 6: Process each match (NO MARKET CACHING - Fresh fetch always)
          const validMatchesPromises = matches
            .filter((match: any) => match && match.id)
            .map(async (match: any) => {
              try {
                const matchId = match.id || match.event?.id;
                const matchName = match.name || match.event?.name || "Unknown Match";
                const openDate = match.openDate || match.event?.openDate || null;
                const status = match.status || "UNKNOWN";

                // console.log(`[SeriesCron] Fetching FRESH markets for match ${matchId}`);

                // ✅ Step 7: ALWAYS FETCH FRESH MARKET DATA (No cache check)
                const markets = await SportsService.getMarkets({
                  eventId: matchId,
                });

                // ✅ Step 8: Calculate inPlay from fresh markets
                let inPlay = false;
                if (markets && markets.length > 0) {
                  inPlay = markets.some((market: any) => market.inPlay === true);
                  // console.log(`[SeriesCron] Match ${matchId} - inPlay: ${inPlay} (from ${markets.length} markets)`);
                }

                return {
                  id: matchId,
                  name: matchName,
                  openDate: openDate,
                  status: status,
                  inPlay: inPlay, // Fresh inPlay status
                };
              } catch (error) {
                console.error(
                  `[SeriesCron] Error fetching markets for match ${match?.id || 'unknown'}:`,
                  error,
                );
                return {
                  id: match.id || match.event?.id,
                  name: match.name || match.event?.name || "Unknown Match",
                  openDate: match.openDate || match.event?.openDate || null,
                  status: match.status || "UNKNOWN",
                  inPlay: false, // Default to false on error
                };
              }
            });

          // ✅ Step 9: Wait for all matches processing
          const validMatches = (await Promise.all(validMatchesPromises))
            .filter(Boolean);

          // ✅ Step 10: CACHE SERIES MATCHES (60 seconds)
          if (validMatches.length > 0) {
            await CacheService.set(seriesCacheKey, validMatches, 60);
            // console.log(`[SeriesCron] Cached ${validMatches.length} matches for series ${seriesId}`);
          }

          // Only return series that have matches
          if (validMatches.length > 0) {
            return {
              id: seriesId,
              name: series.name || series.competition?.name || "Unknown Series",
              eventTypeId: eventTypeId,
              matches: validMatches,
            };
          }

          return null;
        } catch (error) {
          console.error(
            `[SeriesCron] Error getting matches for series ${series?.id || 'unknown'}:`,
            error,
          );
          return null;
        }
      });

      // ✅ Step 11: Wait for all series processing
      const allSeries = await Promise.all(seriesPromises);
      const seriesWithMatches = allSeries.filter(Boolean);

      console.log(
        `[SeriesCron] Found ${seriesWithMatches.length}/${seriesList.length} series with matches for ${eventTypeId}`,
      );

      // ✅ Step 12: CACHE FINAL RESULT (45 seconds)
      if (seriesWithMatches.length > 0) {
        await CacheService.set(cacheKey, seriesWithMatches, 45);
        // console.log(`[SeriesCron] Cached final result for ${eventTypeId}`);
      } else {
        await CacheService.set(cacheKey, [], 30);
        // console.log(`[SeriesCron] Cached empty result for ${eventTypeId}`);
      }

      return seriesWithMatches;
    } catch (error) {
      console.error(
        `[SeriesCron] ❌ Failed to fetch series with matches for ${eventTypeId}:`,
        error,
      );
      return [];
    }
  },
  async getOdds({
    marketId,
  }: {
    marketId: string | string[];
  }) {
    const marketIdArray = Array.isArray(marketId) ? marketId : [marketId];
    // console.log("marketId", marketIdArray)

    const chunks: string[][] = [];
    for (let i = 0; i < marketIdArray.length; i += 30) {
      chunks.push(marketIdArray.slice(i, i + 30));
    }

    try {
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          // If API supports multiple IDs as comma-separated
          const marketIds = chunk.join(",");

          const response = await api.get(
            `/sports/books/${marketIds}`,
          );

          // console.log("oddd",JSON.stringify(response.data, null, 2));

          return response.data;
        }),
      );

      // console.log("resuu",results)

      // Merge all chunk responses into one object
      const odds = Object.assign({}, ...results);

      return odds;
    } catch (error) {
      console.error("getOdds error:", error);
      return [];
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
      console.error("getBookmarkOdds error:");
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
      console.error("getBookmakers error:");
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
      console.error("getScoreMatchesList error:");
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
      console.error("getOddsResults error:");
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
      console.error("getBookmakersResults error:");
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
      console.error("getSessionResults error:");
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
      console.error("getFancyResults error:");
      return [];
    }
  },

  async getSeriesList({ eventTypeId }: { eventTypeId: string }) {
    const cacheKey = `series:${eventTypeId}`;
    try {
      console.log("Fetching active series list from database for eventType:", eventTypeId);

      // Try to get from cache first
      const cached = await CacheService.get<any[]>(cacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        console.log("Returning cached series data");
        return cached;
      }

      // Get active competitions from database where sport_id = eventTypeId and is_active = true
      const activeCompetitions = await db
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
        .orderBy(competitions.name); // Optional: sort by name

      console.log(`Found ${activeCompetitions.length} active competitions in database for sport ${eventTypeId}`);

      // Transform the data to match the expected format
      const formattedData = activeCompetitions.map(comp => ({
        id: comp.competition_id, // Use competition_id as the ID for external compatibility
        name: comp.name,
        sportId: comp.sport_id,
        provider: comp.provider,
        isActive: comp.is_active,
        metadata: comp.metadata,
        addedDate: comp.addedDate,
        updateDate: comp.updateDate,
        // Add any other fields your frontend expects
        totalEvents: (comp.metadata as any)?.totalEvents || 0,
        // Include the database id if needed
        dbId: comp.id
      }));

      // Cache the results
      if (formattedData.length > 0) {
        console.log("Caching series data, count:", formattedData.length);
        await CacheService.set(cacheKey, formattedData, 3 * 60 * 60); // 3 hours
      } else {
        console.log("No active competitions found in database");
      }

      return formattedData || [];
    } catch (error: any) {
      console.error("DEBUG - getSeriesList error:", error);

      // Fallback: Try to get data from cache if available

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
      const cached = await CacheService.get<MatchItem[]>(cacheKey);
      if (cached) return cached;
      const response = await api.get(
        `/sports/competitions/${competitionId}`,
      );
      // console.log("match", response)

      const data = validateArray<any>(response.data.events);

      await CacheService.set(cacheKey, data, 2 * 60); // 2 minutes
      return data;
    } catch (error: any) {
      console.error("getMatchList error:");
      return [];
    }
  },

  async getMarkets({
    eventId,
  }: {
    eventId: string;
  }) {
    const cacheKey = `markets:${eventId}`;

    try {
      const cached = await CacheService.get<MarketItem[]>(cacheKey);
      if (cached) return cached;

      const response = await api.get(
        `/sports/events/${eventId}`,
      );

      const catalogues = Array.isArray(response.data?.catalogues)
        ? response.data.catalogues
        : [];

      if (catalogues.length === 0) {
        console.log(`[getMarkets] No markets yet for event ${eventId}`);
      }

      const data = validateArray<MarketItem>(catalogues);

      await CacheService.set(cacheKey, data, 60); // 60 seconds
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

      await CacheService.set(cacheKey, data, 4 * 60 * 60); // 4 hours
      return data;
    } catch (error) {
      console.error("getBookmakersList error:");
      return [];
    }
  },

  async getMarketsWithOdds({ eventId }: { eventId: string }) {
    try {
      // console.log("Fetching markets for event:", eventId);

      // STEP 1: Get ALL markets
      const allMarkets = await this.getMarkets({ eventId });

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

      // Broadcast market update via WebSocket
      const { broadcastMarketUpdate } = await import("./socket-service");
      broadcastMarketUpdate(eventId, {
        eventId,
        markets: marketsWithOdds,
        timestamp: Date.now(),
      });


      // STEP 5: Sort by sortPriority if available
      return marketsWithOdds

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
      console.error("getBookmakersWithOdds error:");
      return [];
    }
  },

  async getSeriesListWithMatches({ eventTypeId }: { eventTypeId: string }) {
    try {
      const seriesList = await this.getSeriesList({ eventTypeId });
      // console.log("list", seriesList);

      const seriesWithMatches = await Promise.all(
        seriesList.map(async (series) => {
          const matches = await this.getMatchList({
            eventTypeId,
            competitionId: series.competition.id,
          });

          return {
            id: series.competition.id,
            name: series.competition.name,
            matches,
          };
        }),
      );

      const seriesWithMatchesAndOdds = await Promise.all(
        seriesWithMatches.map(async (series) => {
          const matchesWithOdds = await Promise.all(
            series.matches.map(async (match: any) => {
              const odds = await this.getMarketsWithOdds({
                // eventTypeId,
                eventId: match.event.id,
              });

              return {
                ...match,
                odds,
              };
            }),
          );

          return {
            ...series,
            matches: matchesWithOdds,
          };
        }),
      );

      return seriesWithMatchesAndOdds;
    } catch (error) {
      console.log("Series With Matches fetch failed");
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
    try {
      const isRacingEvent = ["7", "4339"].includes(eventTypeId);

      const marketOdds = this.getMarketsWithOdds({
        // eventTypeId,
        eventId: matchId,
      });

      const score = await this.getScore({
        eventTypeId,
        matchId,
      });
      // console.log("score", score);

      // 🐎 Skip unnecessary APIs for Horse Racing
      const premiumFancy = !isRacingEvent
        ? this.getPremiumFancy({ eventTypeId, matchId })
        : Promise.resolve(null);

      const bookmakers = !isRacingEvent
        ? this.getBookmakersWithOdds({ eventTypeId, eventId: matchId })
        : Promise.resolve(null);

      // const sessions = !isRacingEvent
      //   ? this.getSessions({ eventTypeId, matchId })
      //   : Promise.resolve(null);
      const sessions = this.getSessions({ eventTypeId, matchId });

      const [
        marketOddsData,
        scoreData,
        premiumFancyData,
        bookmakersData,
        sessionsData,
      ] = await Promise.all([
        marketOdds,
        score,
        premiumFancy,
        bookmakers,
        sessions,
      ]);

      const data = {
        matchOdds: marketOddsData ?? null,
        score: scoreData ?? null,
        premiumFancy: premiumFancyData ?? null,
        bookmakers: bookmakersData ?? null,
        sessions: sessionsData ?? null,
        showLay: !isRacingEvent,
      };

      return data;
    } catch (error) {
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
