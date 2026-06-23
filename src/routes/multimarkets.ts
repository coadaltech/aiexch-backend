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
  // Per-request user context via .resolve() (NOT .state(), which is module-shared).
  .resolve(async ({ cookie, headers, status, request }) => {
    const state_result = await app_middleware({ cookie, headers, request });
    if (!state_result.data) {
      return status(state_result.code as 401 | 403 | 404 | 500, state_result);
    }
    return {
      userId: state_result.data.id,
      userRole: state_result.data.role,
    };
  })

  // List current user's pinned markets via the get_multimarket(uuid) SQL
  // function which returns a pre-shaped jsonb array.
  .get("/", async ({ userId, set }) => {
    try {
      const result = await db.execute(
        sql`SELECT get_multimarket(${userId}::uuid) AS data`,
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
    async ({ body, userId, set }) => {
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
            userId: userId,
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
            addedBy: userId || SYSTEM_USER_ID,
            updateBy: userId || SYSTEM_USER_ID,
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
    async ({ params, userId, set }) => {
      try {
        await db
          .delete(userMultimarkets)
          .where(
            and(
              eq(userMultimarkets.userId, userId),
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
