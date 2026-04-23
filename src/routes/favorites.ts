// routes/favorites.ts
// Authenticated endpoints for per-user favorite matches (shown in the
// user-facing sidebar's "Favorite matches" dropdown).

import { Elysia, t } from "elysia";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@db/index";
import {
  userFavoriteMatches,
  events,
  competitions,
  sports,
  SYSTEM_USER_ID,
} from "@db/schema";
import { app_middleware } from "../middleware/auth";

export const favoritesRoutes = new Elysia({ prefix: "/api/user/favorites" })
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

  // List current user's favorite matches, enriched with event/competition/sport metadata
  .get("/", async ({ store, set }) => {
    try {
      const rows = await db
        .select({
          favoriteId: userFavoriteMatches.id,
          eventId: userFavoriteMatches.eventId,
          name: events.name,
          competitionId: events.competitionId,
          competitionName: competitions.name,
          sportId: events.sportId,
          sportName: sports.name,
          openDate: events.openDate,
          isActive: events.isActive,
          addedDate: userFavoriteMatches.addedDate,
        })
        .from(userFavoriteMatches)
        .leftJoin(events, eq(events.eventId, userFavoriteMatches.eventId))
        .leftJoin(competitions, eq(competitions.competition_id, events.competitionId))
        .leftJoin(sports, eq(sports.sport_id, events.sportId))
        .where(eq(userFavoriteMatches.userId, store.id))
        .orderBy(desc(userFavoriteMatches.addedDate));

      set.status = 200;
      return { success: true, data: rows, count: rows.length };
    } catch (error) {
      console.error("Error fetching favorites:", error);
      set.status = 500;
      return { success: false, data: [], count: 0 };
    }
  })

  // Add a match (event) to favorites. Idempotent: inserting an existing
  // (user_id, event_id) pair is silently treated as success.
  .post(
    "/:eventId",
    async ({ params, store, set }) => {
      try {
        const eventId = Number(params.eventId);
        if (!Number.isFinite(eventId)) {
          set.status = 400;
          return { success: false, error: "Invalid eventId" };
        }

        await db
          .insert(userFavoriteMatches)
          .values({
            userId: store.id,
            eventId,
            addedBy: store.id || SYSTEM_USER_ID,
            updateBy: store.id || SYSTEM_USER_ID,
          })
          .onConflictDoNothing({
            target: [userFavoriteMatches.userId, userFavoriteMatches.eventId],
          });

        set.status = 200;
        return { success: true };
      } catch (error) {
        console.error("Error adding favorite:", error);
        set.status = 500;
        return { success: false, error: "Failed to add favorite" };
      }
    },
    { params: t.Object({ eventId: t.String() }) },
  )

  // Remove a match from favorites.
  .delete(
    "/:eventId",
    async ({ params, store, set }) => {
      try {
        const eventId = Number(params.eventId);
        if (!Number.isFinite(eventId)) {
          set.status = 400;
          return { success: false, error: "Invalid eventId" };
        }

        await db
          .delete(userFavoriteMatches)
          .where(
            and(
              eq(userFavoriteMatches.userId, store.id),
              eq(userFavoriteMatches.eventId, eventId),
            ),
          );

        set.status = 200;
        return { success: true };
      } catch (error) {
        console.error("Error removing favorite:", error);
        set.status = 500;
        return { success: false, error: "Failed to remove favorite" };
      }
    },
    { params: t.Object({ eventId: t.String() }) },
  );
