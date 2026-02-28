// routes/series-route.ts
import { Elysia, t } from "elysia";
// import { seriesService, SeriesService } from "../services/series-cron-service";
import { redis } from "@db/redis";
import { param } from "drizzle-orm";
import { SportsService } from "@services/sports";
import { CacheService } from "@services/cache";
import { getAvailableSportsList } from "@services/sports-service";



export const seriesRoutes = new Elysia({ prefix: "/api/sports" })
  // Get series for specific event type
  // .get(
  //   "/series/:eventTypeId",
  //   async ({ params }) => {
  //
  //     const { eventTypeId } = params;
  //
  //     //  console.log("hloooo")
  //     //  console.log("ppp",params)
  //     //  console.log("ttt",eventTypeId)
  //
  //     try {
  //       const { eventTypeId } = params;
  //       const data = await seriesService.getSeriesData(eventTypeId);
  //       if (!data || !Array.isArray(data) || data.length === 0) {
  //         console.warn(
  //           `[SeriesCron] Empty data received. Skipping cache for eventTypeId=${eventTypeId}`,
  //         );
  //         return {
  //           success: true,
  //           eventTypeId: eventTypeId,
  //           data: data,
  //           timestamp: new Date().toISOString(),
  //           count: data.length,
  //           message: `Series data for eventType ${eventTypeId} (cron updates every 5 seconds)`,
  //         }; // return but don't cache
  //       }
  //
  //
  //       // await redis.set(cacheKey, JSON.stringify(data), { EX: 5*60 });
  //
  //       return {
  //         success: true,
  //         eventTypeId: eventTypeId,
  //
  //         data: data,
  //         timestamp: new Date().toISOString(),
  //         count: data.length,
  //         message: `Series data for eventType ${eventTypeId} (cron updates every 5 seconds)`,
  //       };
  //     } catch (error: any) {
  //       return {
  //         success: false,
  //         eventTypeId: params.eventTypeId,
  //         message: error.message || "Failed to fetch series data",
  //         data: [],
  //       };
  //     }
  //   },
  //   {
  //     params: t.Object({
  //       eventTypeId: t.String(),
  //     }),
  //   },
  // )

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

  .get("/getAllSeries/:eventTypeId", async ({ params, set }) => {
    // console.log(`[API] Request received for /getAllSeries/${params.eventTypeId}`);
    const { eventTypeId } = params;
    const cacheKey = `series:withMatches:${eventTypeId}`;
    try {
      const cachedData = await CacheService.get<any[]>(cacheKey);
      if (cachedData) {
        // console.log(`[API] Cache HIT for ${cacheKey}`);

        return {
          success: true,
          eventTypeId: eventTypeId,
          data: cachedData,
          timestamp: new Date().toISOString(),
          count: cachedData.length,
          message: `Series data for eventType ${eventTypeId} (from cache)`,
          cached: true,
        };
      }


      // console.log(`[API] Cache MISS for ${cacheKey}, fetching fresh data...`);
      const allSeriesData =
        await SportsService.getSeriesWithMatches(eventTypeId);
      if (allSeriesData.length > 0) {
        await CacheService.set(cacheKey, allSeriesData, 60 * 60); // 5 minutes ttl
      }

      // set.status = 200;

      return {
        success: true,
        eventTypeId: eventTypeId,

        data: allSeriesData,
        timestamp: new Date().toISOString(),
        count: allSeriesData.length,
        message: `Series data for eventType ${eventTypeId} (cron updates every 5 seconds)`,
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
