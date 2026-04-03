// routes/series-route.ts
import { Elysia, t } from "elysia";
import { SportsService } from "@services/sports";
import { getAvailableSportsList } from "@services/sports-service";
import { whitelabel_middleware } from "../middleware/whitelabel";

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

  // Get available sports list
  .get("/sports-list", async () => {
    const sportsList = await getAvailableSportsList();

    return {
      success: true,
      data: sportsList,
      count: sportsList.length,
    };
  });
