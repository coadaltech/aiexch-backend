import {  getCompetitionsBySportId, updateCompetitionsStatus } from "@services/dashboard/games-service";
import { getAvailableSportsList } from "@services/sports-service";
import Elysia from "elysia";


export const gamesRoutes = new Elysia({ prefix: "/api/dashboard" })
  .get("/sports-list", async () => {
    // console.log("yhaaaa");
    const sportsList = await getAvailableSportsList();

    return {
      success: true,
      data: sportsList,
      count: sportsList.length,
    };
  })
  .get("/competitions/:sportId", async ({ params }) => {
    const { sportId } = params;

    console.log("➡️ Fetching competition:", sportId);

    const competitions = await getCompetitionsBySportId(sportId);

    return {
      success: true,
      data: competitions,
      count: competitions.length,
    };
  })

  // games-routes.ts
  .post("/competitions/update-status", async ({ body }) => {
    try {
      const { sportId, competitions } = body as {
        sportId: string;
        competitions: Array<{ id: string; isActive: boolean }>;
      };

      console.log("📝 Received update request for sport:", sportId);
      console.log(`Updates: ${competitions.length} competitions to update`);

      if (!sportId || !competitions || !Array.isArray(competitions)) {
        return {
          success: false,
          message: "Invalid request data",
        };
      }

      // If no competitions to update, return early
      if (competitions.length === 0) {
        return {
          success: true,
          message: "No updates needed",
          sportId,
          updatedCount: 0,
        };
      }

      const result = await updateCompetitionsStatus(sportId, competitions);

      return {
        ...result,
        sportId,
        updatedCount: competitions.length,
      };
    } catch (error) {
      console.error("❌ Error in update-status endpoint:", error);
      return {
        success: false,
        message: "Internal server error",
      };
    }
  });

