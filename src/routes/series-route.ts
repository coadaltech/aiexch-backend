// routes/series-route.ts
import { Elysia, t } from "elysia";
import { SportsService } from "@services/sports";
import { getAvailableSportsList } from "@services/sports-service";
import { whitelabel_middleware } from "../middleware/whitelabel";
import { app_middleware } from "../middleware/auth";

export const seriesRoutes = new Elysia({ prefix: "/api/sports" })

  .get("/getMarketWithOdds/:eventId", async ({ params }) => {
    const { eventId } = params;
    try {
      const data = await SportsService.getMarketsWithOdds({ eventId })
      return {
        success: true,
        eventId,
        data,
      };
    } catch (error: any) {
      return {
        success: false,
        eventId,
        message: error.message || "Failed to fetch market with odds",
        data: [],
      };
    }
  })

  .get("/getAllSeries/:eventTypeId", async ({ params, request }) => {
    const { eventTypeId } = params;
    try {
      // Resolve whitelabel from request domain header
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId = whitelabel?.id || undefined;

      const allSeriesData = await SportsService.getSeriesWithMatches(eventTypeId, whitelabelId);

      return {
        success: true,
        eventTypeId: eventTypeId,
        data: allSeriesData,
        timestamp: new Date().toISOString(),
        count: allSeriesData.length,
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        eventTypeId: params.eventTypeId,
        message: err.message || "Failed to fetch series data",
        data: [],
      };
    }
  })

  // Flat list of matches + defaultMarketId + per-user betCount for the
  // homepage "matches list" component. Powered by
  // fn_get_matches_with_default_markets — odds are NOT included; the client
  // subscribes to /ws/markets for live odds per marketId.
  .get("/matches-list/:eventTypeId", async ({ params, request, cookie, headers }) => {
    const { eventTypeId } = params;
    try {
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId = whitelabel?.id || undefined;

      // Resolve signed-in user (if any). Anonymous callers still get the list,
      // just with betCount = 0 for every row.
      const auth = await app_middleware({ cookie, headers, request });
      const userId = auth?.success && auth.data?.id ? auth.data.id : undefined;

      const data = await SportsService.getMatchesWithDefaultMarkets(
        eventTypeId,
        whitelabelId,
        userId,
      );

      return {
        success: true,
        eventTypeId,
        data,
        timestamp: new Date().toISOString(),
        count: data.length,
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        eventTypeId,
        message: err.message || "Failed to fetch matches list",
        data: [],
      };
    }
  })

  // Get available sports list
  .get("/sports-list", async () => {
    const sportsList = await getAvailableSportsList();

    return {
      success: true,
      data: sportsList,
      count: sportsList.length,
    };
  });
