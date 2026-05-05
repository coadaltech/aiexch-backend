import { Elysia, t } from "elysia";
import { db } from "../../db";
import { sports, sportsGames, competitions, events, SYSTEM_USER_ID } from "../../db/schema";
import { eq } from "drizzle-orm";
import { CacheService } from "../../services/cache";
import { invalidateSportsListCache } from "../../services/sports-service";
import { broadcastChange } from "../../services/sports-broadcast";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { resolveOwnerScope } from "../../utils/ownerScope";
import { UserRole } from "../../types/enums";
import { DbType } from "../../types";
import {
  getCompetitionsWithOverrides,
  getCompetitionsPaged,
  updateCompetitionsStatus,
  upsertCompetitionWhitelabelOverrides,
  getEventsWithOverrides,
  getEventsPaged,
  updateEventsStatus,
  upsertEventWhitelabelOverrides,
} from "../../services/dashboard/games-service";
import { syncCompetitions } from "../../db/seed";

export const sportsGamesRoutes = new Elysia({ prefix: "/sports-games" })
  .resolve(async ({ request }): Promise<{ resolvedDb: DbType; whitelabel: any }> => {
    const { db: resolvedDb, whitelabel } = await whitelabel_middleware(request);
    return { resolvedDb: resolvedDb as DbType, whitelabel };
  })
  .get("/", async ({ set }) => {
    try {
      const games = await db.select().from(sports);
      console.log("gaa",games)
      set.status = 200;
      return { success: true, data: games };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch sports games" };
    }
  })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const [game] = await db
          .insert(sportsGames)
          .values({
            eventType: body.eventType,
            name: body.name,
            imageUrl: body.imageUrl,
            linkPath: body.linkPath,
            marketCount: body.marketCount || 0,
            status: body.status || "active",
          })
          .returning();
        set.status = 201;
        return { success: true, data: game };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to create sports game" };
      }
    },
    {
      body: t.Object({
        eventType: t.String(),
        name: t.String(),
        imageUrl: t.Optional(t.String()),
        linkPath: t.Optional(t.String()),
        marketCount: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const [game] = await db
          .update(sportsGames)
          .set({
            eventType: body.eventType,
            name: body.name,
            imageUrl: body.imageUrl,
            linkPath: body.linkPath,
            marketCount: body.marketCount,
            status: body.status,
            updateDate: new Date(),
          })
          .where(eq(sportsGames.id, params.id))
          .returning();
        set.status = 200;
        return { success: true, data: game };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update sports game" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        eventType: t.String(),
        name: t.String(),
        imageUrl: t.Optional(t.String()),
        linkPath: t.Optional(t.String()),
        marketCount: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .delete("/:id", async ({ params, set }) => {
    try {
      await db.delete(sportsGames).where(eq(sportsGames.id, params.id));
      set.status = 200;
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to delete sports game" };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // ── Bulk reorder sports (drag-and-drop display order) ─────────────────
  .put(
    "/reorder",
    async ({ body, set }) => {
      try {
        const { sports: sportOrders } = body as {
          sports: Array<{ sportId: number; sortOrder: number }>;
        };

        for (const { sportId, sortOrder } of sportOrders) {
          await db
            .update(sports)
            .set({ sort_order: sortOrder, updateBy: SYSTEM_USER_ID, updateDate: new Date() })
            .where(eq(sports.sport_id, sportId));
        }

        // Bust the sports list cache so the sidebar reflects the new order immediately
        await invalidateSportsListCache();

        set.status = 200;
        return { success: true };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to reorder sports" };
      }
    },
  )

  // ── Toggle sport active/inactive (owner only) ─────────────────────────
  .post(
    "/toggle-active/:sportId",
    async ({ params, body, set }) => {
      try {
        const sportId = Number(params.sportId);
        if (!Number.isFinite(sportId)) {
          set.status = 400;
          return { success: false, error: "Invalid sportId" };
        }

        const { isActive } = body as { isActive: boolean };

        const [updated] = await db
          .update(sports)
          .set({
            is_active: isActive,
            updateBy: SYSTEM_USER_ID,
            updateDate: new Date(),
          })
          .where(eq(sports.sport_id, sportId))
          .returning({ sport_id: sports.sport_id, is_active: sports.is_active });

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Sport not found" };
        }

        await invalidateSportsListCache();

        set.status = 200;
        return {
          success: true,
          data: { sportId: updated.sport_id, isActive: updated.is_active },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update sport status" };
      }
    },
    {
      params: t.Object({ sportId: t.String() }),
      body: t.Object({ isActive: t.Boolean() }),
    },
  )

  // ── Toggle sport live/coming-soon (owner only) ────────────────────────
  // Independent from is_active: when is_live=false the sport stays in nav
  // but its public page shows a "Coming Soon" banner.
  .post(
    "/toggle-live/:sportId",
    async ({ params, body, set }) => {
      try {
        const sportId = Number(params.sportId);
        if (!Number.isFinite(sportId)) {
          set.status = 400;
          return { success: false, error: "Invalid sportId" };
        }

        const { isLive } = body as { isLive: boolean };

        const [updated] = await db
          .update(sports)
          .set({
            is_live: isLive,
            updateBy: SYSTEM_USER_ID,
            updateDate: new Date(),
          })
          .where(eq(sports.sport_id, sportId))
          .returning({ sport_id: sports.sport_id, is_live: sports.is_live });

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Sport not found" };
        }

        await invalidateSportsListCache();

        set.status = 200;
        return {
          success: true,
          data: { sportId: updated.sport_id, isLive: updated.is_live },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update sport live state" };
      }
    },
    {
      params: t.Object({ sportId: t.String() }),
      body: t.Object({ isLive: t.Boolean() }),
    },
  )

  // ── Toggle a competition's "top competition" flag (owner only) ────────
  .post(
    "/toggle-top-competition/:competitionId",
    async ({ params, body, set }) => {
      try {
        const competitionId = Number(params.competitionId);
        if (!Number.isFinite(competitionId)) {
          set.status = 400;
          return { success: false, error: "Invalid competitionId" };
        }

        const { isTop } = body as { isTop: boolean };

        const [updated] = await db
          .update(competitions)
          .set({
            is_top_competition: isTop,
            updateBy: SYSTEM_USER_ID,
            updateDate: new Date(),
          })
          .where(eq(competitions.competition_id, competitionId))
          .returning({
            competition_id: competitions.competition_id,
            is_top_competition: competitions.is_top_competition,
          });

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Competition not found" };
        }

        broadcastChange("top-competitions");

        set.status = 200;
        return {
          success: true,
          data: {
            competitionId: updated.competition_id,
            isTop: updated.is_top_competition,
          },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update top-competition flag" };
      }
    },
    {
      params: t.Object({ competitionId: t.String() }),
      body: t.Object({ isTop: t.Boolean() }),
    },
  )

  // ── Toggle an event's "recommended" flag (owner only) ─────────────────
  .post(
    "/toggle-recommended-event/:eventId",
    async ({ params, body, set }) => {
      try {
        const eventId = Number(params.eventId);
        if (!Number.isFinite(eventId)) {
          set.status = 400;
          return { success: false, error: "Invalid eventId" };
        }

        const { isRecommended } = body as { isRecommended: boolean };

        const [updated] = await db
          .update(events)
          .set({
            isRecommended,
            updateBy: SYSTEM_USER_ID,
            updateDate: new Date(),
          })
          .where(eq(events.eventId, eventId))
          .returning({
            eventId: events.eventId,
            isRecommended: events.isRecommended,
          });

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Event not found" };
        }

        broadcastChange("recommended-events");

        set.status = 200;
        return {
          success: true,
          data: {
            eventId: updated.eventId,
            isRecommended: updated.isRecommended,
          },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, error: "Failed to update recommended flag" };
      }
    },
    {
      params: t.Object({ eventId: t.String() }),
      body: t.Object({ isRecommended: t.Boolean() }),
    },
  )

  // ── Sync all competitions from external API ────────────────────────────
  .post("/sync-competitions", async ({ set }) => {
    try {
      const result = await syncCompetitions();
      set.status = 200;
      return { success: true, data: result };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to sync competitions" };
    }
  })

  // ── Competition endpoints (role + whitelabel aware) ─────────────────────

  .get("/competitions/:sportId", async ({ params, query, set, userId, userRole, whitelabel }: any) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        { id: userId, role: String(userRole) },
      );

      const limitRaw = Number((query as any)?.limit);
      const offsetRaw = Number((query as any)?.offset);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
      const search = typeof (query as any)?.search === "string" ? (query as any).search : "";

      const { items, totalCount } = await getCompetitionsPaged(
        params.sportId,
        scope.currentUserRole,
        scope.scopeWhitelabelId,
        search,
        limit,
        offset,
      );

      // Get sport name
      const [sport] = await db
        .select({ name: sports.name })
        .from(sports)
        .where(eq(sports.sport_id, Number(params.sportId)))
        .limit(1);

      return {
        success: true,
        data: items,
        sportName: sport?.name ?? "",
        role: scope.currentUserRole,
        count: items.length,
        totalCount,
        limit,
        offset,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch competitions" };
    }
  }, {
    params: t.Object({ sportId: t.String() }),
    query: t.Optional(
      t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    ),
  })

  .post("/competitions/:sportId/update-status", async ({ params, body, set, userId, userRole, whitelabel }: any) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        { id: userId, role: String(userRole) },
      );

      const { competitions: updates } = body as {
        competitions: Array<{ id: string; isActive: boolean }>;
      };

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return { success: true, message: "No updates needed" };
      }

      // Owner: update global is_active
      if (scope.currentUserRole === UserRole.Owner) {
        const result = await updateCompetitionsStatus(params.sportId, updates);
        return result;
      }

      // Admin: upsert per-whitelabel overrides
      if (scope.currentUserRole === UserRole.Admin) {
        if (!scope.scopeWhitelabelId) {
          set.status = 400;
          return { success: false, message: "No whitelabel associated with your account" };
        }
        const result = await upsertCompetitionWhitelabelOverrides(
          params.sportId,
          scope.scopeWhitelabelId,
          updates,
          scope.currentUserId,
        );
        return result;
      }

      // Super/Master/Agent: read-only
      set.status = 403;
      return { success: false, message: "You do not have permission to update competitions" };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to update competitions" };
    }
  }, {
    params: t.Object({ sportId: t.String() }),
  })

  // ── Event endpoints (per-competition, role + whitelabel aware) ─────────────

  .get("/events/:competitionId", async ({ params, query, set, userId, userRole, whitelabel }: any) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        { id: userId, role: String(userRole) },
      );

      const limitRaw = Number((query as any)?.limit);
      const offsetRaw = Number((query as any)?.offset);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
      const search = typeof (query as any)?.search === "string" ? (query as any).search : "";

      const { items, totalCount } = await getEventsPaged(
        params.competitionId,
        scope.currentUserRole,
        scope.scopeWhitelabelId,
        search,
        limit,
        offset,
      );

      // Get competition name
      const [comp] = await db
        .select({ name: competitions.name, sport_id: competitions.sport_id })
        .from(competitions)
        .where(eq(competitions.competition_id, Number(params.competitionId)))
        .limit(1);

      return {
        success: true,
        data: items,
        competitionName: comp?.name ?? "",
        sportId: comp?.sport_id ?? 0,
        role: scope.currentUserRole,
        count: items.length,
        totalCount,
        limit,
        offset,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch events" };
    }
  }, {
    params: t.Object({ competitionId: t.String() }),
    query: t.Optional(
      t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    ),
  })

  .post("/events/:competitionId/update-status", async ({ params, body, set, userId, userRole, whitelabel }: any) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        { id: userId, role: String(userRole) },
      );

      const { events: updates } = body as {
        events: Array<{ id: string; isActive: boolean }>;
      };

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return { success: true, message: "No updates needed" };
      }

      // Owner: update global isActive
      if (scope.currentUserRole === UserRole.Owner) {
        const result = await updateEventsStatus(params.competitionId, updates);
        return result;
      }

      // Admin: upsert per-whitelabel overrides
      if (scope.currentUserRole === UserRole.Admin) {
        if (!scope.scopeWhitelabelId) {
          set.status = 400;
          return { success: false, message: "No whitelabel associated with your account" };
        }
        const result = await upsertEventWhitelabelOverrides(
          params.competitionId,
          scope.scopeWhitelabelId,
          updates,
          scope.currentUserId,
        );
        return result;
      }

      // Super/Master/Agent: read-only
      set.status = 403;
      return { success: false, message: "You do not have permission to update events" };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to update events" };
    }
  }, {
    params: t.Object({ competitionId: t.String() }),
  });
