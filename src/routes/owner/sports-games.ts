import { Elysia, t } from "elysia";
import { db } from "../../db";
import { sports, sportsGames } from "../../db/schema";
import { eq } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { resolveOwnerScope } from "../../utils/ownerScope";
import { UserRole } from "../../types/enums";
import { DbType } from "../../types";
import {
  getCompetitionsWithOverrides,
  updateCompetitionsStatus,
  upsertCompetitionWhitelabelOverrides,
} from "../../services/dashboard/games-service";

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

  // ── Competition endpoints (role + whitelabel aware) ─────────────────────

  .get("/competitions/:sportId", async ({ params, set, store, whitelabel }) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        store as { id?: string; role?: string },
      );

      const data = await getCompetitionsWithOverrides(
        params.sportId,
        scope.currentUserRole,
        scope.scopeWhitelabelId,
      );

      // Get sport name
      const [sport] = await db
        .select({ name: sports.name })
        .from(sports)
        .where(eq(sports.sport_id, Number(params.sportId)))
        .limit(1);

      return {
        success: true,
        data,
        sportName: sport?.name ?? "",
        role: scope.currentUserRole,
        count: data.length,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch competitions" };
    }
  }, {
    params: t.Object({ sportId: t.String() }),
  })

  .post("/competitions/:sportId/update-status", async ({ params, body, set, store, whitelabel }) => {
    try {
      const scope = await resolveOwnerScope(
        db as DbType,
        whitelabel ?? undefined,
        store as { id?: string; role?: string },
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
  });
