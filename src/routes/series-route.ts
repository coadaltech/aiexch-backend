// routes/series-route.ts
import { Elysia, t } from "elysia";
import { SportsService } from "@services/sports";
import { getAvailableSportsList } from "@services/sports-service";
import { whitelabel_middleware } from "../middleware/whitelabel";
import { app_middleware } from "../middleware/auth";
import { readNotepad } from "@services/notepad";
import { RACING_EVENT_TYPE_IDS } from "@services/event-sync-service";
import { readMatchListSnapshot } from "@services/match-list-snapshot-service";

export const seriesRoutes = new Elysia({ prefix: "/api/sports" })

  // Racing (Horse 7 / Greyhound 4339): no competition layer. Returns meetings
  // grouped by country -> venue for the racing page (served from the notepad).
  .get("/racing/:eventTypeId", async ({ params }) => {
    const { eventTypeId } = params;
    try {
      if (!RACING_EVENT_TYPE_IDS.includes(Number(eventTypeId))) {
        return { success: false, eventTypeId, message: "Not a racing sport", data: [] };
      }
      const np = await readNotepad<any[]>(`racing-${eventTypeId}`);
      // Backstop: only meetings that still have races (the sync already drops
      // empty ones, but never show a venue with 0 races).
      const meetings = (np?.data ?? []).filter(
        (m: any) => Array.isArray(m.races) && m.races.length > 0,
      );

      // Group meetings by countryCode, each with its venues (meetings).
      const byCountry = new Map<string, any[]>();
      for (const m of meetings) {
        const cc = m.countryCode || "OTHER";
        if (!byCountry.has(cc)) byCountry.set(cc, []);
        byCountry.get(cc)!.push(m);
      }
      const countries = Array.from(byCountry.entries())
        .map(([countryCode, list]) => ({ countryCode, meetings: list }))
        .sort((a, b) => a.countryCode.localeCompare(b.countryCode));

      return {
        success: true,
        eventTypeId,
        data: countries,
        updatedAt: np?.updatedAt ?? null,
        count: meetings.length,
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, eventTypeId, message: err.message, data: [] };
    }
  })

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
      const whitelabelName = (whitelabel as any)?.name || undefined;

      const allSeriesData = await SportsService.getSeriesWithMatches(
        eventTypeId,
        whitelabelId,
        whitelabelName,
      );

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

  // Combined events + default-market ODDS snapshot for a sport, served from a
  // single shared notepad file the background loop keeps fresh. The match list
  // seeds from this so every row paints at once (no one-by-one reveal as odds
  // trickle in over the WebSocket). Whitelabel-agnostic / anonymous: per-user
  // betCount and any whitelabel visibility are still applied client-side via
  // the authenticated matches-list fetch. Live odds continue over /ws/markets.
  .get("/matchlist-snapshot/:eventTypeId", async ({ params }) => {
    const { eventTypeId } = params;
    try {
      const snap = await readMatchListSnapshot(eventTypeId);
      return {
        success: true,
        eventTypeId,
        data: snap?.data ?? [],
        updatedAt: snap?.updatedAt ?? null,
        count: snap?.data?.length ?? 0,
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        eventTypeId,
        message: err.message || "Failed to fetch match list snapshot",
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
