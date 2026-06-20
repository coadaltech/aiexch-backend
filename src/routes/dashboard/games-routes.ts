import { getCompetitionsBySportId } from "@services/dashboard/games-service";
import { getAvailableSportsList } from "@services/sports-service";
import { db } from "@db/index";
import { competitions, competitionWhitelabelOverrides, events, eventWhitelabelOverrides, sports } from "@db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { whitelabel_middleware } from "@middleware/whitelabel";
import Elysia from "elysia";


export const gamesRoutes = new Elysia({ prefix: "/api/dashboard" })
  .get("/sports-list", async () => {
    // Includes inactive sports so the owner admin panel can toggle them back on.
    const sportsList = await getAvailableSportsList({ includeInactive: true });

    return {
      success: true,
      data: sportsList,
      count: sportsList.length,
    };
  })
  // Public read-only: only returns globally active competitions
  .get("/competitions/:sportId", async ({ params }) => {
    const { sportId } = params;

    const allCompetitions = await getCompetitionsBySportId(sportId);
    const activeOnly = allCompetitions.filter((c: any) => c.is_active);

    return {
      success: true,
      data: activeOnly,
      count: activeOnly.length,
    };
  })

  // ── Sidebar feed: top competitions (owner-flagged, only active ones) ─────
  .get("/sidebar/top-competitions", async () => {
    try {
      const rows = await db
        .select({
          competitionId: competitions.competition_id,
          name: competitions.name,
          sportId: competitions.sport_id,
          sportName: sports.name,
        })
        .from(competitions)
        .leftJoin(sports, eq(sports.sport_id, competitions.sport_id))
        .where(
          and(
            eq(competitions.is_top_competition, true),
            eq(competitions.is_active, true),
            eq(sports.is_active, true),
          ),
        )
        .orderBy(asc(sports.sort_order), asc(competitions.name));

      return { success: true, data: rows, count: rows.length };
    } catch (error) {
      console.error("Error fetching top competitions:", error);
      return { success: false, data: [], count: 0 };
    }
  })

  // ── Sidebar feed: recommended events (owner-flagged, only active ones) ───
  .get("/sidebar/recommended-events", async () => {
    try {
      const rows = await db
        .select({
          eventId: events.eventId,
          name: events.name,
          competitionId: events.competitionId,
          competitionName: competitions.name,
          sportId: events.sportId,
          sportName: sports.name,
          openDate: events.openDate,
        })
        .from(events)
        .leftJoin(competitions, eq(competitions.competition_id, events.competitionId))
        .leftJoin(sports, eq(sports.sport_id, events.sportId))
        .where(
          and(
            eq(events.isRecommended, true),
            eq(events.isActive, true),
            eq(sports.is_active, true),
          ),
        )
        .orderBy(asc(events.openDate));

      return { success: true, data: rows, count: rows.length };
    } catch (error) {
      console.error("Error fetching recommended events:", error);
      return { success: false, data: [], count: 0 };
    }
  })

  // ── Drop-header feed: owner-pinned events ────────────────────────────────
  // Whitelabel-aware: an event the requesting whitelabel disabled (an event
  // override with is_active = false) is hidden even though the owner pinned it
  // globally. The `x-whitelabel-domain` header is resolved per-request.
  .get("/sidebar/pinned-events", async ({ request }) => {
    try {
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId: string | null = whitelabel?.id ?? null;

      const rows = await db
        .select({
          eventId: events.eventId,
          name: events.name,
          pinLabel: events.pinLabel,
          competitionId: events.competitionId,
          competitionName: competitions.name,
          sportId: events.sportId,
          sportName: sports.name,
          openDate: events.openDate,
          // null when no per-whitelabel override row exists (defaults to shown)
          whitelabelActive: whitelabelId
            ? eventWhitelabelOverrides.isActive
            : sql<boolean | null>`null`,
        })
        .from(events)
        .leftJoin(competitions, eq(competitions.competition_id, events.competitionId))
        .leftJoin(sports, eq(sports.sport_id, events.sportId))
        .leftJoin(
          eventWhitelabelOverrides,
          whitelabelId
            ? and(
                eq(eventWhitelabelOverrides.eventId, events.eventId),
                eq(eventWhitelabelOverrides.whitelabelId, whitelabelId),
              )
            : sql`false`,
        )
        .where(
          and(
            eq(events.isPinned, true),
            eq(events.isActive, true),
            eq(sports.is_active, true),
          ),
        )
        .orderBy(asc(events.openDate));

      // Drop events this whitelabel explicitly disabled. A null override means
      // "no override" → still shown.
      const visible = rows
        .filter((r) => r.whitelabelActive !== false)
        .map(({ whitelabelActive, ...r }) => ({
          ...r,
          label: r.pinLabel || r.name,
        }));

      return { success: true, data: visible, count: visible.length };
    } catch (error) {
      console.error("Error fetching pinned events:", error);
      return { success: false, data: [], count: 0 };
    }
  })

  // ── Drop-header feed: owner-pinned competitions ──────────────────────────
  // Whitelabel-aware (mirrors /sidebar/pinned-events): a competition the
  // requesting whitelabel disabled (an override with is_active = false) is
  // hidden even though the owner pinned it globally.
  .get("/sidebar/pinned-competitions", async ({ request }) => {
    try {
      const { whitelabel } = await whitelabel_middleware(request);
      const whitelabelId: string | null = whitelabel?.id ?? null;

      const rows = await db
        .select({
          competitionId: competitions.competition_id,
          name: competitions.name,
          pinLabel: competitions.pin_label,
          sportId: competitions.sport_id,
          sportName: sports.name,
          // null when no per-whitelabel override row exists (defaults to shown)
          whitelabelActive: whitelabelId
            ? competitionWhitelabelOverrides.isActive
            : sql<boolean | null>`null`,
        })
        .from(competitions)
        .leftJoin(sports, eq(sports.sport_id, competitions.sport_id))
        .leftJoin(
          competitionWhitelabelOverrides,
          whitelabelId
            ? and(
                eq(competitionWhitelabelOverrides.competitionId, competitions.competition_id),
                eq(competitionWhitelabelOverrides.whitelabelId, whitelabelId),
              )
            : sql`false`,
        )
        .where(
          and(
            eq(competitions.is_pinned, true),
            eq(competitions.is_active, true),
            eq(sports.is_active, true),
          ),
        )
        .orderBy(asc(competitions.name));

      // Drop competitions this whitelabel explicitly disabled. A null override
      // means "no override" → still shown.
      const visible = rows
        .filter((r) => r.whitelabelActive !== false)
        .map(({ whitelabelActive, ...r }) => ({
          ...r,
          label: r.pinLabel || r.name,
        }));

      return { success: true, data: visible, count: visible.length };
    } catch (error) {
      console.error("Error fetching pinned competitions:", error);
      return { success: false, data: [], count: 0 };
    }
  });
