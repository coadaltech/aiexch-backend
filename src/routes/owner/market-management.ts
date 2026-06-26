import { Elysia, t } from "elysia";
import { AdminMarketService } from "@services/admin-market-service";
import { db } from "@db/index";
import { marketOddsHistory, marketSettings, events } from "@db/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { UserRole } from "../../types/enums";
import { requirePermission } from "../../middleware/permissions";
import { readNotepad } from "@services/notepad";

// Racing event types (Horse 7 / Greyhound 4339) — no competition layer; the
// racing admin view browses meetings/races straight from the racing notepad.
const RACING_EVENT_TYPE_IDS = [7, 4339];

// Price entry schema: {price, size, line?}
// `line` is only present for LINE markets — it's the over/under value.
const PriceEntry = t.Object({
  price: t.Number(),
  size: t.Number(),
  line: t.Optional(t.Number()),
});

export const marketManagementRoutes = new Elysia({
  prefix: "/market-management",
})

  // ═══════════════════════════════════════════════════════════
  //  EVENT SEARCH
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/events/search?q=xxx
  .get(
    "/events/search",
    async ({ query, set }) => {
      try {
        const results = await AdminMarketService.searchEvents(
          query.q || "",
          Math.min(parseInt(query.limit || "20"), 50)
        );
        return { success: true, data: results };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to search events" };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // ═══════════════════════════════════════════════════════════
  //  EVENT SETTINGS
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/events/:eventId
  .get(
    "/events/:eventId",
    async ({ params, set }) => {
      try {
        const data = await AdminMarketService.getEventSettings(params.eventId);
        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to fetch event settings" };
      }
    },
    { params: t.Object({ eventId: t.String() }) }
  )

  // PUT /owner/market-management/events/:eventId
  .put(
    "/events/:eventId",
    async ({ params, body, set, userId, userRole }: any) => {
      try {
        // Get whitelabelId for admin scoping
        let whitelabelId: string | undefined;
        if (userRole === UserRole.Admin) {
          whitelabelId =
            (await AdminMarketService.getUserWhitelabelId(
              userId
            )) || undefined;
        }

        const result = await AdminMarketService.upsertEventSettings(
          params.eventId,
          { ...body, whitelabelId }
        );
        return { success: true, data: result };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update event settings" };
      }
    },
    {
      params: t.Object({ eventId: t.String() }),
      body: t.Object({
        competitionId: t.Optional(t.String()),
        sportId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        isVisible: t.Optional(t.Boolean()),
        suspended: t.Optional(t.Boolean()),
        betDelay: t.Optional(t.Number()),
        maxMarketProfit: t.Optional(t.Number()),
      }),
    }
  )

  // ═══════════════════════════════════════════════════════════
  //  MARKET SETTINGS
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/markets?eventId=xxx
  .get(
    "/markets",
    async ({ query, set }) => {
      try {
        if (query.eventId) {
          const data = await AdminMarketService.listMarketsByEvent(
            query.eventId
          );
          return { success: true, data };
        }
        // Return all markets if no eventId filter
        const data = await db.select().from(marketSettings);
        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to fetch markets" };
      }
    },
    { query: t.Object({ eventId: t.Optional(t.String()) }) }
  )

  // GET /owner/market-management/markets/:marketId
  .get(
    "/markets/:marketId",
    async ({ params, set }) => {
      try {
        const data = await AdminMarketService.getMarketSettings(
          params.marketId
        );
        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to fetch market settings" };
      }
    },
    { params: t.Object({ marketId: t.String() }) }
  )

  // PUT /owner/market-management/markets/:marketId
  .put(
    "/markets/:marketId",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.upsertMarketSettings(
          params.marketId,
          body
        );
        return { success: true, data: result };
      } catch (error) {
        console.error("[market-management] PUT /markets/:marketId error:", error);
        set.status = 500;
        return { success: false, error: "Failed to update market settings", detail: (error as Error)?.message };
      }
    },
    {
      params: t.Object({ marketId: t.String() }),
      body: t.Object({
        eventId: t.Optional(t.String()),
        marketName: t.Optional(t.String()),
        marketType: t.Optional(t.String()),
        bettingType: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        isVisible: t.Optional(t.Boolean()),
        suspended: t.Optional(t.Boolean()),
        betLock: t.Optional(t.Boolean()),
        betDelay: t.Optional(t.Number()),
        minBet: t.Optional(t.Number()),
        maxBet: t.Optional(t.Number()),
        maxProfit: t.Optional(t.Number()),
        sortPriority: t.Optional(t.Number()),
      }),
    }
  )

  // PUT /owner/market-management/events/:eventId/bulk-settings
  // Apply min/max bet and bet delay to many markets of an event at once.
  // The client sends the exact target markets (already filtered by type) so
  // the update matches what the owner sees on screen.
  .put(
    "/events/:eventId/bulk-settings",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.bulkUpsertMarketSettings(
          params.eventId,
          body.markets,
          {
            ...(body.betDelay !== undefined && { betDelay: body.betDelay }),
            ...(body.minBet !== undefined && { minBet: body.minBet }),
            ...(body.maxBet !== undefined && { maxBet: body.maxBet }),
            ...(body.maxProfit !== undefined && { maxProfit: body.maxProfit }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
            ...(body.isVisible !== undefined && { isVisible: body.isVisible }),
            ...(body.suspended !== undefined && { suspended: body.suspended }),
            ...(body.betLock !== undefined && { betLock: body.betLock }),
          }
        );
        return { success: true, data: result };
      } catch (error) {
        console.error(
          "[market-management] PUT /events/:eventId/bulk-settings error:",
          error
        );
        set.status = 500;
        return {
          success: false,
          error: "Failed to apply bulk market settings",
          detail: (error as Error)?.message,
        };
      }
    },
    {
      params: t.Object({ eventId: t.String() }),
      body: t.Object({
        markets: t.Array(
          t.Object({
            marketId: t.String(),
            marketName: t.Optional(t.String()),
            marketType: t.Optional(t.String()),
            bettingType: t.Optional(t.String()),
          })
        ),
        betDelay: t.Optional(t.Number()),
        minBet: t.Optional(t.Number()),
        maxBet: t.Optional(t.Number()),
        maxProfit: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        isVisible: t.Optional(t.Boolean()),
        suspended: t.Optional(t.Boolean()),
        betLock: t.Optional(t.Boolean()),
      }),
    }
  )

  // ═══════════════════════════════════════════════════════════
  //  RACING (Horse 7 / Greyhound 4339) — admin browser
  //  Mirrors the public racing layout (country → venue/meeting → races)
  //  and merges each race's WIN-market admin settings so the owner can see,
  //  per race, what's active/suspended and tune all market controls.
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/racing/:eventTypeId
  .get(
    "/racing/:eventTypeId",
    async ({ params, set }) => {
      try {
        const eventTypeId = Number(params.eventTypeId);
        if (!RACING_EVENT_TYPE_IDS.includes(eventTypeId)) {
          set.status = 400;
          return { success: false, error: "Not a racing sport", data: [] };
        }

        // Structural source: the racing notepad (only meetings that still have
        // open races). Same data the public racing page renders.
        const np = await readNotepad<any[]>(`racing-${eventTypeId}`);
        const meetings = (np?.data ?? []).filter(
          (m: any) => Array.isArray(m.races) && m.races.length > 0,
        );

        // Pull existing per-market overrides for every race in one query.
        const allMarketIds = meetings.flatMap((m: any) =>
          m.races.map((r: any) => String(r.marketId)),
        );
        const settingsByMarket = new Map<string, any>();
        if (allMarketIds.length) {
          const rows = await db
            .select()
            .from(marketSettings)
            .where(inArray(marketSettings.marketId, allMarketIds));
          for (const r of rows) settingsByMarket.set(String(r.marketId), r);
        }

        // Event-level active flag (auto-managed by the racing sync).
        const eventIds = meetings.map((m: any) => Number(m.eventId));
        const eventActive = new Map<number, boolean>();
        if (eventIds.length) {
          const erows = await db
            .select({ eventId: events.eventId, isActive: events.isActive })
            .from(events)
            .where(inArray(events.eventId, eventIds));
          for (const e of erows) eventActive.set(Number(e.eventId), e.isActive);
        }

        const byCountry = new Map<string, any[]>();
        for (const m of meetings) {
          const races = m.races.map((r: any) => {
            const s = settingsByMarket.get(String(r.marketId));
            return {
              marketId: String(r.marketId),
              name: r.name,
              raceTime: r.raceTime ?? null,
              // null = never configured → the live pipeline applies defaults
              // (active/visible, provider bet delay, no min/max).
              settings: s
                ? {
                    isActive: s.isActive,
                    isVisible: s.isVisible,
                    suspended: s.suspended,
                    betLock: s.betLock,
                    betDelay: s.betDelay,
                    minBet: s.minBet != null ? Number(s.minBet) : null,
                    maxBet: s.maxBet != null ? Number(s.maxBet) : null,
                    maxProfit: s.maxProfit != null ? Number(s.maxProfit) : null,
                    notice: s.notice ?? null,
                  }
                : null,
            };
          });
          const cc = m.countryCode || "OTHER";
          if (!byCountry.has(cc)) byCountry.set(cc, []);
          byCountry.get(cc)!.push({
            eventId: m.eventId,
            name: m.name,
            venue: m.venue ?? null,
            countryCode: m.countryCode ?? null,
            timezone: m.timezone ?? null,
            openDate: m.openDate ?? null,
            marketCount: m.marketCount ?? races.length,
            isActive: eventActive.get(Number(m.eventId)) ?? true,
            races,
          });
        }

        const countries = Array.from(byCountry.entries())
          .map(([countryCode, list]) => ({ countryCode, meetings: list }))
          .sort((a, b) => a.countryCode.localeCompare(b.countryCode));

        return {
          success: true,
          eventTypeId: String(eventTypeId),
          data: countries,
          updatedAt: np?.updatedAt ?? null,
          count: meetings.length,
        };
      } catch (error) {
        console.error("[market-management] GET /racing/:eventTypeId error:", error);
        set.status = 500;
        return {
          success: false,
          error: "Failed to fetch racing markets",
          detail: (error as Error)?.message,
          data: [],
        };
      }
    },
    { params: t.Object({ eventTypeId: t.String() }) },
  )

  // PUT /owner/market-management/markets/:marketId/notice
  // Permission-gated: add/edit the user-facing notice/remark for a market.
  .put(
    "/markets/:marketId/notice",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.updateMarketNotice(
          params.marketId,
          body.notice ?? "",
          body.eventId
        );
        return { success: true, data: result };
      } catch (error) {
        console.error("[market-management] PUT /markets/:marketId/notice error:", error);
        set.status = 500;
        return { success: false, error: "Failed to update market notice" };
      }
    },
    {
      beforeHandle: requirePermission("market_notice.manage"),
      params: t.Object({ marketId: t.String() }),
      body: t.Object({
        notice: t.String(),
        eventId: t.Optional(t.String()),
      }),
    }
  )

  // ═══════════════════════════════════════════════════════════
  //  CUSTOM MARKETS
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/custom-markets — list all custom markets with search/filter
  .get(
    "/custom-markets",
    async ({ query, set }) => {
      try {
        const data = await AdminMarketService.listCustomMarkets({
          search: query.search,
          status: (query.status as "active" | "inactive" | "all") || "all",
          limit: query.limit ? parseInt(query.limit) : 50,
          offset: query.offset ? parseInt(query.offset) : 0,
        });
        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to list custom markets" };
      }
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )

  // POST /owner/market-management/custom-markets
  .post(
    "/custom-markets",
    async ({ body, set, userId, userRole }: any) => {
      try {
        // Get whitelabelId for admin scoping
        let whitelabelId: string | undefined;
        if (userRole === UserRole.Admin) {
          whitelabelId =
            (await AdminMarketService.getUserWhitelabelId(
              userId
            )) || undefined;
        }

        const result = await AdminMarketService.createCustomMarket({
          ...body,
          whitelabelId,
        });

        if (!result || !result.success) {
          set.status = 400;
          return {
            success: false,
            error: (result as any)?.error || "Failed to create custom market",
          };
        }

        set.status = 201;
        return { success: true, data: result };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to create custom market" };
      }
    },
    {
      body: t.Object({
        eventId: t.String(),
        marketName: t.String(),
        bettingType: t.String(),
        runners: t.Array(
          t.Object({
            name: t.String(),
            back: t.Optional(t.Array(PriceEntry)),
            lay: t.Optional(t.Array(PriceEntry)),
          }),
          { minItems: 1 }
        ),
        minBet: t.Optional(t.Number()),
        maxBet: t.Optional(t.Number()),
        maxProfit: t.Optional(t.Number()),
        betDelay: t.Optional(t.Number()),
      }),
    }
  )

  // GET /owner/market-management/custom-markets/:marketId
  .get(
    "/custom-markets/:marketId",
    async ({ params, set }) => {
      try {
        const data = await AdminMarketService.getCustomMarketDetails(
          params.marketId
        );
        if (!data) {
          set.status = 404;
          return { success: false, error: "Custom market not found" };
        }
        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to fetch custom market" };
      }
    },
    { params: t.Object({ marketId: t.String() }) }
  )

  // PUT /owner/market-management/custom-markets/:marketId — edit custom market details
  .put(
    "/custom-markets/:marketId",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.updateCustomMarketDetails(
          params.marketId,
          body
        );
        if (!result.success) {
          set.status = 400;
          return result;
        }
        return { success: true, data: result };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update custom market" };
      }
    },
    {
      params: t.Object({ marketId: t.String() }),
      body: t.Object({
        marketName: t.Optional(t.String()),
        bettingType: t.Optional(t.String()),
        minBet: t.Optional(t.Number()),
        maxBet: t.Optional(t.Number()),
        betDelay: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        runners: t.Optional(
          t.Array(
            t.Object({
              selectionId: t.Optional(t.Number()),
              name: t.String(),
            })
          )
        ),
      }),
    }
  )

  // PUT /owner/market-management/custom-markets/:marketId/ball-running
  .put(
    "/custom-markets/:marketId/ball-running",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.setCustomMarketBallRunning(
          params.marketId,
          body.ballRunning
        );
        return { success: true, data: result };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: "Failed to toggle ball running",
        };
      }
    },
    {
      params: t.Object({ marketId: t.String() }),
      body: t.Object({ ballRunning: t.Boolean() }),
    }
  )

  // PUT /owner/market-management/custom-markets/:marketId/odds
  .put(
    "/custom-markets/:marketId/odds",
    async ({ params, body, set }) => {
      try {
        const result = await AdminMarketService.updateCustomOdds(
          params.marketId,
          body.selectionId,
          {
            back: body.back,
            lay: body.lay,
            ballRunning: body.ballRunning,
          }
        );
        if (!result.success) {
          set.status = 400;
          return result;
        }
        return { success: true, data: result };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update custom odds" };
      }
    },
    {
      params: t.Object({ marketId: t.String() }),
      body: t.Object({
        selectionId: t.String(),
        back: t.Optional(t.Array(PriceEntry)),
        lay: t.Optional(t.Array(PriceEntry)),
        ballRunning: t.Optional(t.Boolean()),
      }),
    }
  )

  // DELETE /owner/market-management/custom-markets/:marketId
  .delete(
    "/custom-markets/:marketId",
    async ({ params, set }) => {
      try {
        const result = await AdminMarketService.deleteCustomMarket(
          params.marketId
        );
        if (!result.success) {
          // 409 when the market has bets and can't be deleted; 404 otherwise.
          set.status = result.error === "Market not found" ? 404 : 409;
          return result;
        }
        return { success: true };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to delete custom market" };
      }
    },
    { params: t.Object({ marketId: t.String() }) }
  )

  // ═══════════════════════════════════════════════════════════
  //  ODDS HISTORY
  // ═══════════════════════════════════════════════════════════

  // GET /owner/market-management/odds-history?marketId=xxx&from=...&to=...
  .get(
    "/odds-history",
    async ({ query, set }) => {
      try {
        const conditions = [];

        if (query.marketId) {
          conditions.push(
            eq(marketOddsHistory.marketId, query.marketId)
          );
        }
        if (query.eventId) {
          conditions.push(
            eq(marketOddsHistory.eventId, Number(query.eventId))
          );
        }
        if (query.from) {
          conditions.push(
            gte(marketOddsHistory.capturedAt, new Date(query.from))
          );
        }
        if (query.to) {
          conditions.push(
            lte(marketOddsHistory.capturedAt, new Date(query.to))
          );
        }

        const limit = Math.min(parseInt(query.limit || "100"), 1000);

        const data = await db
          .select()
          .from(marketOddsHistory)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(marketOddsHistory.capturedAt))
          .limit(limit);

        return { success: true, data, count: data.length };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to fetch odds history" };
      }
    },
    {
      query: t.Object({
        marketId: t.Optional(t.String()),
        eventId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
