// routes/multimarkets.ts
// Authenticated endpoints for per-user pinned markets. A user can pin
// individual markets from multiple events; the /multimarket page renders just
// those markets with live odds. Metadata (event / competition / sport / market
// names) is cached on the row at pin time — markets themselves are not
// persisted in the DB, they come from the external sports API.

import { Elysia, t } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@db/index";
import { userMultimarkets, SYSTEM_USER_ID } from "@db/schema";
import { app_middleware } from "../middleware/auth";

export const multimarketsRoutes = new Elysia({ prefix: "/api/user/multimarkets" })
  .state({ id: "", role: 0 as number })
  .guard({
    async beforeHandle({ cookie, headers, set, store }) {
      const state_result = await app_middleware({ cookie, headers });
      set.status = state_result.code;
      if (!state_result.data) return state_result;
      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })

  // List current user's pinned markets via the get_multimarket(uuid) SQL
  // function which returns a pre-shaped jsonb array.
  .get("/", async ({ store, set }) => {
    try {
      const result = await db.execute(
        sql`SELECT get_multimarket(${store.id}::uuid) AS data`,
      );
      const data = (result as any)?.[0]?.data ?? [];
      set.status = 200;
      return { success: true, data, count: Array.isArray(data) ? data.length : 0 };
    } catch (error) {
      console.error("Error fetching multimarkets:", error);
      set.status = 500;
      return { success: false, data: [], count: 0 };
    }
  })

  // Pin a market. Idempotent on (user_id, market_id).
  .post(
    "/",
    async ({ body, store, set }) => {
      try {
        const {
          sportId,
          sportName,
          competitionId,
          competitionName,
          eventId,
          eventName,
          openDate,
          marketId,
          marketName,
          marketType,
        } = body;

        await db
          .insert(userMultimarkets)
          .values({
            userId: store.id,
            sportId: Number(sportId),
            sportName,
            competitionId: Number(competitionId),
            competitionName,
            eventId: Number(eventId),
            eventName,
            openDate: openDate ? new Date(openDate) : null,
            marketId,
            marketName,
            marketType,
            addedBy: store.id || SYSTEM_USER_ID,
            updateBy: store.id || SYSTEM_USER_ID,
          })
          .onConflictDoNothing({
            target: [userMultimarkets.userId, userMultimarkets.marketId],
          });

        set.status = 200;
        return { success: true };
      } catch (error) {
        console.error("Error pinning market:", error);
        set.status = 500;
        return { success: false, error: "Failed to pin market" };
      }
    },
    {
      body: t.Object({
        sportId: t.Union([t.Number(), t.String()]),
        sportName: t.String(),
        competitionId: t.Union([t.Number(), t.String()]),
        competitionName: t.String(),
        eventId: t.Union([t.Number(), t.String()]),
        eventName: t.String(),
        openDate: t.Optional(t.Union([t.String(), t.Null()])),
        marketId: t.String(),
        marketName: t.String(),
        marketType: t.String(),
      }),
    },
  )

  // Unpin a market.
  .delete(
    "/:marketId",
    async ({ params, store, set }) => {
      try {
        await db
          .delete(userMultimarkets)
          .where(
            and(
              eq(userMultimarkets.userId, store.id),
              eq(userMultimarkets.marketId, params.marketId),
            ),
          );

        set.status = 200;
        return { success: true };
      } catch (error) {
        console.error("Error unpinning market:", error);
        set.status = 500;
        return { success: false, error: "Failed to unpin market" };
      }
    },
    { params: t.Object({ marketId: t.String() }) },
  );
