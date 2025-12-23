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
      const response = await api.get("/getSport");
      const data = validateArray<Sports>(response.data);
      return data;
    } catch (error: any) {
      console.error("getSports error:", error.response?.status, error.message);
      return [];
    }
  },

  async getOdds({
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
            `/getMarketsOdds?EventTypeID=${eventTypeId}&marketId=${marketIds}`
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
        })
      );
      return results.flat();
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
            `/getBookmakerOdds?EventTypeID=${eventTypeId}&marketId=${marketIds}`
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
        })
      );
      return results.flat();
    } catch (error) {
      console.error("getBookmarkOdds error:", error);
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
        `/getBookmakerOdds?EventTypeID=${eventTypeId}&marketId=${marketIds}`
      );
      const data = validateArray<BookmakerItem>(response.data);
      return data;
    } catch (error) {
      console.error("getBookmakers error:", error);
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
      const url = `/getSessions?EventTypeID=${eventTypeId}&matchId=${matchId}${
        gtype ? `&gtype=${gtype}` : ""
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
        `/getPremium?EventTypeID=${eventTypeId}&matchId=${matchId}`
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
        `/score?EventTypeID=${eventTypeId}&matchId=${matchId}`
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
        `/matches/list?EventTypeID=${eventTypeId}`
      );
      return validateArray<ScoreMatches>(response.data);
    } catch (error) {
      console.error("getScoreMatchesList error:", error);
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
        `/oddsResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`
      );
      const data = validateArray<Odds>(response.data);
      return data;
    } catch (error) {
      console.error("getOddsResults error:", error);
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
        `/bookmakersResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      console.error("getBookmakersResults error:", error);
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
        `/sessionsResults?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      console.error("getSessionResults error:", error);
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
        `/fancy1Results?EventTypeID=${eventTypeId}&marketId=${marketIdStr}`
      );
      const data = validateArray<MatchResult>(response.data);
      return data;
    } catch (error) {
      console.error("getFancyResults error:", error);
      return [];
    }
  },

  async getSeriesList({ eventTypeId }: { eventTypeId: string }) {
    const cacheKey = `series:${eventTypeId}`;
    try {
      const cached = await CacheService.get<CompetitionItem[]>(cacheKey);
      if (cached) return cached;

      const url = `/fetch_data?Action=listCompetitions&EventTypeID=${eventTypeId}`;
      const response = await api.get(url);
      const data = validateArray<CompetitionItem>(response.data);

      await CacheService.set(cacheKey, data, 3 * 60 * 60); // 3 hours
      return data;
    } catch (error: any) {
      console.error("DEBUG - getSeriesList error:", {
        baseURL: api.defaults.baseURL,
        eventTypeId,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
      });
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
        `/fetch_data?Action=listEvents&EventTypeID=${eventTypeId}&CompetitionID=${competitionId}`
      );
      const data = validateArray<MatchItem>(response.data);

      await CacheService.set(cacheKey, data, 2 * 60 * 60); // 2 hours
      return data;
    } catch (error: any) {
      console.error(
        "getMatchList error:",
        error.response?.status,
        error.message
      );
      return [];
    }
  },

  async getMarkets({
    eventTypeId,
    eventId,
  }: {
    eventTypeId: string;
    eventId: string;
  }) {
    const cacheKey = `markets:${eventTypeId}:${eventId}`;
    try {
      const cached = await CacheService.get<MarketItem[]>(cacheKey);
      if (cached) return cached;

      const response = await api.get(
        `/getMarkets?EventTypeID=${eventTypeId}&EventID=${eventId}`
      );

      const data = validateArray<MarketItem>(response.data);

      await CacheService.set(cacheKey, data, 4 * 60 * 60); // 4 hours
      return data;
    } catch (error) {
      console.error("getMarkets error:", error);
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
        `/getBookmakers?EventTypeID=${eventTypeId}&EventID=${eventId}`
      );
      const data = validateArray<BookmakerMarket>(response.data);

      await CacheService.set(cacheKey, data, 4 * 60 * 60); // 4 hours
      return data;
    } catch (error) {
      console.error("getBookmakersList error:", error);
      return [];
    }
  },

  async getMarketsWithOdds({
    eventTypeId,
    eventId,
  }: {
    eventTypeId: string;
    eventId: string;
  }) {
    try {
      const markets = await this.getMarkets({ eventTypeId, eventId });

      if (!markets || markets.length === 0) {
        return [];
      }

      const marketIds = markets
        .map((market) => market.marketId)
        .filter(Boolean);

      if (marketIds.length === 0) {
        return markets;
      }

      const odds = await this.getOdds({ eventTypeId, marketId: marketIds });

      const marketsWithOdds = markets.map((market) => {
        const marketOdds = odds.find(
          (odd) => odd && odd.marketId === market.marketId
        );
        return {
          ...market,
          odds: marketOdds || null,
        };
      });

      // Sort by sr_no field
      return marketsWithOdds.sort((a, b) => {
        const aSrNo = (a as any).sr_no || 0;
        const bSrNo = (b as any).sr_no || 0;
        return aSrNo - bSrNo;
      });
    } catch (error) {
      console.error("WithOdds error:", error);
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
          (odd) => odd && odd.marketId === market.marketId
        );
        return {
          ...market,
          odds: marketOdds || null,
        };
      });

      return marketsWithOdds;
    } catch (error) {
      console.error("getBookmakersWithOdds error:", error);
      return [];
    }
  },

  async getSeriesListWithMatches({ eventTypeId }: { eventTypeId: string }) {
    try {
      const seriesList = await this.getSeriesList({ eventTypeId });

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
        })
      );

      const seriesWithMatchesAndOdds = await Promise.all(
        seriesWithMatches.map(async (series) => {
          const matchesWithOdds = await Promise.all(
            series.matches.map(async (match: any) => {
              const odds = await this.getMarketsWithOdds({
                eventTypeId,
                eventId: match.event.id,
              });

              return {
                ...match,
                odds,
              };
            })
          );

          return {
            ...series,
            matches: matchesWithOdds,
          };
        })
      );

      return seriesWithMatchesAndOdds;
    } catch (error) {
      console.log("Series With Matches fetch failed", error);
      return [];
    }
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
        eventTypeId,
        eventId: matchId,
      });

      const score = this.getScore({
        eventTypeId,
        matchId,
      });

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
