import { Elysia, t } from "elysia";
import { AdminMarketService } from "@services/admin-market-service";
import { db } from "@db/index";
import { marketOddsHistory, marketSettings, events } from "@db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

// Price entry schema: {price, size}
const PriceEntry = t.Object({
  price: t.Number(),
  size: t.Number(),
});

export const marketManagementRoutes = new Elysia({
  prefix: "/market-management",
})

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
    async ({ params, body, set, store }) => {
      try {
        // Get whitelabelId for admin scoping
        let whitelabelId: string | undefined;
        if ((store as any).role === "admin") {
          whitelabelId =
            (await AdminMarketService.getUserWhitelabelId(
              (store as any).id
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
        set.status = 500;
        return { success: false, error: "Failed to update market settings" };
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

  // ═══════════════════════════════════════════════════════════
  //  CUSTOM MARKETS
  // ═══════════════════════════════════════════════════════════

  // POST /owner/market-management/custom-markets
  .post(
    "/custom-markets",
    async ({ body, set, store }) => {
      try {
        // Get whitelabelId for admin scoping
        let whitelabelId: string | undefined;
        if ((store as any).role === "admin") {
          whitelabelId =
            (await AdminMarketService.getUserWhitelabelId(
              (store as any).id
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
          set.status = 404;
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
            eq(marketOddsHistory.eventId, query.eventId)
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
