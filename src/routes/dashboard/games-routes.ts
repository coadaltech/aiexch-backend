import { getCompetitionsBySportId } from "@services/dashboard/games-service";
import { getAvailableSportsList } from "@services/sports-service";
import Elysia from "elysia";


export const gamesRoutes = new Elysia({ prefix: "/api/dashboard" })
  .get("/sports-list", async () => {
    const sportsList = await getAvailableSportsList();

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
  });

