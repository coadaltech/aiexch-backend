import { Elysia } from "elysia";
import { db } from "../db";
import { sportsGames } from "../db/schema";
import { eq } from "drizzle-orm";
import { SportsService } from "../services/sports";

export const sportsRoutes = new Elysia({ prefix: "/sports" })
  .get("/", async ({ set }) => {
    try {
      const data = await db
        .select()
        .from(sportsGames)
        .where(eq(sportsGames.status, "active"));
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch sports games" };
    }
  })

  .get("/games", async ({ set }) => {
    try {
      const data = await SportsService.getSports();
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch sports games" };
    }
  })
  .get("/odds/:eventTypeId/:marketId", async ({ params, set }) => {
    try {
      const data = await SportsService.getOdds({
        // eventTypeId: params.eventTypeId,
        marketId: params.marketId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch odds" };
    }
  })
  .get("/bookmakers/:eventTypeId/:marketId", async ({ params, set }) => {
    try {
      const data = await SportsService.getBookmakers({
        eventTypeId: params.eventTypeId,
        marketId: params.marketId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch bookmakers" };
    }
  })
  .get("/sessions/:eventTypeId/:matchId", async ({ params, query, set }) => {
    try {
      const data = await SportsService.getSessions({
        eventTypeId: params.eventTypeId,
        matchId: params.matchId,
        gtype: query.gtype,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch sessions" };
    }
  })
  .get("/premium/:eventTypeId/:matchId", async ({ params, set }) => {
    try {
      const data = await SportsService.getPremiumFancy({
        eventTypeId: params.eventTypeId,
        matchId: params.matchId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch premium fancy" };
    }
  })
  .get("/score/:eventTypeId/:matchId", async ({ params, set }) => {
    try {
      const data = await SportsService.getScore({
        eventTypeId: params.eventTypeId,
        matchId: params.matchId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch score" };
    }
  })
  .get("/series/:eventTypeId", async ({ params, set }) => {
    try {

      const data = await SportsService.getSeriesListWithMatches({
        eventTypeId: params.eventTypeId,
      });
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch series" };
    }
  })
  .get("/matches/:eventTypeId/:competitionId", async ({ params, set }) => {
    try {
      const data = await SportsService.getMatchList({
        eventTypeId: params.eventTypeId,
        competitionId: params.competitionId,
      });
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch matches" };
    }
  })
  .get("/markets/:eventTypeId/:eventId", async ({ params, set }) => {
    try {
      const data = await SportsService.getMarkets({
        eventId: params.eventId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch markets" };
    }
  })
  .get("/markets-with-odds/:eventTypeId/:eventId", async ({ params, set }) => {
    try {
      const data = await SportsService.getMarketsWithOdds({
        eventId: params.eventId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch markets with odds" };
    }
  })
  .get(
    "/bookmakers-with-odds/:eventTypeId/:eventId",
    async ({ params, set }) => {
      try {
        const data = await SportsService.getBookmakersWithOdds({
          eventTypeId: params.eventTypeId,
          eventId: params.eventId,
        });
        set.status = 200;
        return { success: true, data };
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch markets with odds" };
      }
    }
  )
  .get("/bookmakers-list/:eventTypeId/:eventId", async ({ params, set }) => {
    try {
      const data = await SportsService.getBookmakersList({
        eventTypeId: params.eventTypeId,
        eventId: params.eventId,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch bookmakers list" };
    }
  })

  .post("/results/odds", async ({ body, set }) => {
    try {
      const { eventTypeId, marketIds } = body as {
        eventTypeId: string;
        marketIds: string[];
      };
      const data = await SportsService.getOddsResults({
        eventTypeId,
        marketIds,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch odds results" };
    }
  })
  .post("/results/bookmakers", async ({ body, set }) => {
    try {
      const { eventTypeId, marketIds } = body as {
        eventTypeId: string;
        marketIds: string[];
      };
      const data = await SportsService.getBookmakersResults({
        eventTypeId,
        marketIds,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch bookmaker results" };
    }
  })
  .post("/results/sessions", async ({ body, set }) => {
    try {
      const { eventTypeId, marketIds } = body as {
        eventTypeId: string;
        marketIds: string[];
      };
      const data = await SportsService.getSessionResults({
        eventTypeId,
        marketIds,
      });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch session results" };
    }
  })
  .post("/results/fancy", async ({ body, set }) => {
    try {
      const { eventTypeId, marketIds } = body as {
        eventTypeId: string;
        marketIds: string[];
      };
      const data = await SportsService.getFancyResults({
        eventTypeId,
        marketIds,
      });
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch fancy results" };
    }
  })
  .get("/new-result/:eventId", async ({ params, set }) => {
    try {
      const data = await SportsService.getNewMatchResults({ eventId: params.eventId });
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch new market results" };
    }
  })

  .post("/matchDetails/:eventTypeId/:eventId", async ({ set, params }) => {
    try {
      const { eventTypeId, eventId } = params;
      const data = await SportsService.getMatchDetails({
        eventTypeId,
        matchId: eventId,
      });
      set.status = 200;
      return { success: true, data };
    } catch (err) {
      set.status = 500;
      return { success: false, error: "Failed to fetch match details" };
    }
  });
