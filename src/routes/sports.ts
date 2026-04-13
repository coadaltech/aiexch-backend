import { Elysia } from "elysia";
import { db } from "../db";
import { sportsGames, transactions } from "../db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { SportsService } from "../services/sports";
import { getAvailableSportsList } from "../services/sports-service";
import { whitelabel_middleware } from "../middleware/whitelabel";
import { app_middleware } from "../middleware/auth";

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
      const data = await getAvailableSportsList();
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
  .get("/series/:eventTypeId", async ({ params, set, request }) => {
    try {
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId = whitelabel?.id || undefined;

      const data = await SportsService.getSeriesWithMatches(
        params.eventTypeId,
        whitelabelId,
      );
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch series" };
    }
  })
  .get("/matches/:eventTypeId/:competitionId", async ({ params, set, request }) => {
    try {
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId = whitelabel?.id || undefined;

      const data = await SportsService.getEventsFromDb({
        competitionId: params.competitionId,
        whitelabelId,
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

  // Returns the current user's bet counts per match for a list of matchIds (comma-separated)
  .get("/bet-counts", async ({ query, set, cookie, headers }) => {
    try {
      const ids = (query?.matchIds as string || "").split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length === 0) {
        set.status = 200;
        return { success: true, data: {} };
      }

      const auth = await app_middleware({ cookie, headers });
      if (!auth.success || !auth.data?.id) {
        set.status = 200;
        return { success: true, data: {} };
      }
      const userId = auth.data.id;

      const rows = await db
        .select({
          matchId: transactions.matchId,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(transactions)
        .where(and(inArray(transactions.matchId, ids), eq(transactions.userId, userId)))
        .groupBy(transactions.matchId);
      const data: Record<string, number> = {};
      for (const row of rows) {
        data[String(row.matchId)] = row.count;
      }
      set.status = 200;
      return { success: true, data };
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch bet counts" };
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
