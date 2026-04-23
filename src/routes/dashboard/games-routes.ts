import { getCompetitionsBySportId } from "@services/dashboard/games-service";
import { getAvailableSportsList } from "@services/sports-service";
import { db } from "@db/index";
import { competitions, events, sports } from "@db/schema";
import { and, asc, eq } from "drizzle-orm";
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
  });
