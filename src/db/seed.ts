import { db } from "./index";
import { sports, competitions, users, SYSTEM_USER_ID } from "./schema";
import { eq } from "drizzle-orm";
import { UserRole } from "../types/enums";
import { generateHashPassword } from "../utils/password";
import cron from "node-cron";
import { syncAllActiveCompetitionEvents } from "../services/event-sync-service";

// API Configuration
const API_BASE_URL = "https://api.aiexch.com/Soe81s9017b44b6d822da257xk055b11/sports";

// ── ID remappings: API returns one ID but competitions live under a different ID ─
const SPORT_ID_REMAPPINGS: Record<number, number> = {
  2378961: 500, // Politics — API event ID is 2378961, but competitions are fetched under 500
};

// ── Manually managed sports that are not returned by the external API ──────────
const MANUAL_SPORTS = [
  { sport_id: 1001, name: "Matka" },
  { sport_id: 1002, name: "Lottery" },
  { sport_id: 1003, name: "Skill Games" },
  { sport_id: 1004, name: "Jambo" },
];

// Helper function for API calls
const fetchApi = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching from ${url}:`, error);
    throw error;
  }
};

// Get sports from API
const getSportsFromApi = async () => {
  try {
    console.log("Fetching sports from API...");
    const data = await fetchApi(`${API_BASE_URL}/eventtypes`);

    if (Array.isArray(data)) {
      return data;
    } else if (data.data && Array.isArray(data.data)) {
      return data.data;
    } else if (data.eventTypes && Array.isArray(data.eventTypes)) {
      return data.eventTypes;
    } else {
      console.error("Unknown API response format:", data);
      return [];
    }
  } catch (error) {
    console.error("Failed to fetch sports from API:", error);
    return [];
  }
};

// Get competitions for a sport from API
const getCompetitionsFromApi = async (sportId: number) => {
  try {
    console.log(`Fetching competitions for sport ID: ${sportId}...`);
    const data = await fetchApi(`${API_BASE_URL}/competitions/list/${sportId}`);

    if (Array.isArray(data)) {
      return data;
    } else if (data.data && Array.isArray(data.data)) {
      return data.data;
    } else if (data.competitions && Array.isArray(data.competitions)) {
      return data.competitions;
    } else if (data.competition && Array.isArray(data.competition)) {
      return data.competition;
    } else {
      console.error(
        `Unknown competitions API response format for sport ${sportId}:`,
        data,
      );
      return [];
    }
  } catch (error) {
    console.error(`Failed to fetch competitions for sport ${sportId}:`, error);
    return [];
  }
};

// DB Operations
const upsertSport = async (sportData: any) => {
  try {
    let sportId =
      sportData.id ||
      sportData.eventTypeId ||
      sportData.sport_id ||
      sportData.eventType?.id;
    // Apply ID remapping (e.g. Politics 2378961 → 500)
    if (sportId && SPORT_ID_REMAPPINGS[Number(sportId)]) {
      sportId = SPORT_ID_REMAPPINGS[Number(sportId)];
    }
    const sportName =
      sportData.name ||
      sportData.eventTypeName ||
      sportData.eventType?.name ||
      "Unknown Sport";

    if (!sportId) {
      console.log("Skipping sport - missing ID:", sportData);
      return { operation: "skipped", reason: "missing_id" };
    }

    const existing = await db
      .select()
      .from(sports)
      .where(eq(sports.sport_id, Number(sportId)))
      .limit(1);

    const sportToSave = {
      sport_id: Number(sportId),
      name: sportName,
      is_active: false,
      sort_order: sportData.sortOrder || sportData.sort_order || 0,
      updateBy: SYSTEM_USER_ID,
      updateDate: new Date(),
    };

    let operationType = "";

    if (existing.length > 0) {
      await db
        .update(sports)
        .set(sportToSave)
        .where(eq(sports.sport_id, Number(sportId)));
      operationType = "updated";
      console.log(`Updated sport: ${sportName} (ID: ${sportId})`);
    } else {
      await db.insert(sports).values({
        ...sportToSave,
        addedBy: SYSTEM_USER_ID,
        addedDate: new Date(),
      });
      operationType = "added";
      console.log(`Added new sport: ${sportName} (ID: ${sportId})`);
    }

    return { operation: operationType, sportId: Number(sportId), sportName };
  } catch (error: any) {
    console.error("Error upserting sport:", error, sportData);
    return { operation: "error", error: error.message };
  }
};

const upsertCompetition = async (compData: any, sportId: number) => {
  try {
    const competition = compData.competition || compData;

    const compId = competition.id || compData.competitionId || compData.id;
    const compName =
      competition.name ||
      compData.name ||
      compData.competitionName ||
      "Unknown Competition";
    const provider = competition.provider || compData.provider || "BETFAIR";

    if (!compId) {
      console.log("Skipping competition - missing ID:", compData);
      return { operation: "skipped", reason: "missing_id" };
    }

    const existing = await db
      .select()
      .from(competitions)
      .where(eq(competitions.competition_id, Number(compId)))
      .limit(1);

    if (existing.length > 0) {
      return {
        operation: "skipped",
        reason: "already_exists",
        competitionId: Number(compId),
        competitionName: compName,
      };
    }

    await db.insert(competitions).values({
      competition_id: Number(compId),
      sport_id: Number(sportId),
      name: compName,
      provider: provider,
      is_active: false,
      is_archived: competition.isArchived || compData.isArchived || false,
      metadata: competition.metadata || compData.metadata || {},
      addedBy: SYSTEM_USER_ID,
      addedDate: new Date(),
      updateBy: SYSTEM_USER_ID,
      updateDate: new Date(),
    });

    console.log(`Added NEW competition: ${compName} (ID: ${compId})`);

    return {
      operation: "added",
      competitionId: Number(compId),
      competitionName: compName,
    };
  } catch (error: any) {
    console.error("Error upserting competition:", error, compData);
    return { operation: "error", error: error.message };
  }
};

// Sync Functions
const syncSports = async () => {
  console.log("Starting sports sync...");

  try {
    const sportsData = await getSportsFromApi();
    console.log(`Received ${sportsData.length} sports from API`);

    let addedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const sport of sportsData) {
      const result = await upsertSport(sport);

      if (result.operation === "added") {
        addedCount++;
      } else if (result.operation === "updated") {
        updatedCount++;
      } else if (result.operation === "error") {
        errorCount++;
      }
    }

    console.log(
      `Sports sync done — Total: ${sportsData.length} | Added: ${addedCount} | Updated: ${updatedCount} | Errors: ${errorCount}`,
    );

    // Upsert manually managed sports (matka, lottery, etc.)
    // Preserves is_active if the row already exists
    for (const manual of MANUAL_SPORTS) {
      try {
        const existing = await db
          .select()
          .from(sports)
          .where(eq(sports.sport_id, manual.sport_id))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(sports)
            .set({ name: manual.name, updateBy: SYSTEM_USER_ID, updateDate: new Date() })
            .where(eq(sports.sport_id, manual.sport_id));
          console.log(`Manual sport updated: ${manual.name} (ID: ${manual.sport_id})`);
        } else {
          await db.insert(sports).values({
            sport_id: manual.sport_id,
            name: manual.name,
            is_active: false,
            sort_order: 0,
            addedBy: SYSTEM_USER_ID,
            addedDate: new Date(),
            updateBy: SYSTEM_USER_ID,
            updateDate: new Date(),
          });
          console.log(`Manual sport added: ${manual.name} (ID: ${manual.sport_id})`);
        }
      } catch (err: any) {
        console.error(`Error upserting manual sport ${manual.name}:`, err.message);
      }
    }

    return {
      total: sportsData.length,
      added: addedCount,
      updated: updatedCount,
      errors: errorCount,
    };
  } catch (error) {
    console.error("Sports sync failed:", error);
    return { total: 0, added: 0, updated: 0, errors: 1 };
  }
};

const syncCompetitions = async () => {
  console.log("Starting competitions sync...");

  try {
    const dbSports = await db.select().from(sports);

    console.log(`Found ${dbSports.length} sports in database`);

    let totalCompetitions = 0;
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const totalSports = dbSports.length;

    for (let i = 0; i < dbSports.length; i++) {
      const sport = dbSports[i];
      const sportNumber = i + 1;

      console.log(
        `Processing sport ${sportNumber}/${totalSports}: ${sport.name} (ID: ${sport.sport_id})`,
      );

      try {
        const competitionsData = await getCompetitionsFromApi(sport.sport_id);

        if (competitionsData.length === 0) {
          console.log(`No competitions found for ${sport.name}`);
          continue;
        }

        let sportAdded = 0;
        let sportUpdated = 0;
        let sportErrors = 0;

        for (const comp of competitionsData) {
          const result = await upsertCompetition(comp, sport.sport_id);

          if (result.operation === "added") {
            sportAdded++;
            totalAdded++;
          } else if (result.operation === "updated") {
            sportUpdated++;
            totalUpdated++;
          } else if (result.operation === "error") {
            sportErrors++;
            totalErrors++;
          }
        }

        totalCompetitions += competitionsData.length;

        console.log(
          `Sport "${sport.name}" — Total: ${competitionsData.length} | New: ${sportAdded} | Updated: ${sportUpdated} | Errors: ${sportErrors}`,
        );
      } catch (sportError) {
        console.error(`Error processing sport ${sport.name}:`, sportError);
        totalErrors++;
      }
    }

    console.log(
      `Competitions sync done — Sports: ${totalSports} | Competitions: ${totalCompetitions} | Added: ${totalAdded} | Updated: ${totalUpdated} | Errors: ${totalErrors}`,
    );

    return {
      totalSports,
      totalCompetitions,
      added: totalAdded,
      updated: totalUpdated,
      errors: totalErrors,
    };
  } catch (error) {
    console.error("Competitions sync failed:", error);
    return {
      totalSports: 0,
      totalCompetitions: 0,
      added: 0,
      updated: 0,
      errors: 1,
    };
  }
};

// ── System User Bootstrap ────────────────────────────────────────────────────
/** Ensures the "system" user row exists (used as default for audit columns). */
export const ensureSystemUser = async () => {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, SYSTEM_USER_ID))
    .limit(1);

  if (existing.length > 0) {
    console.log("[Seed] System user already exists");
    return;
  }

  const hashedPassword = await generateHashPassword("system-no-login-" + Date.now());
  await db.insert(users).values({
    id: SYSTEM_USER_ID,
    username: "system",
    email: "system@internal",
    password: hashedPassword,
    role: UserRole.Owner,
    groupId: UserRole.Owner,
    accountStatus: false, // cannot login
    emailVerified: false,
    addedBy: SYSTEM_USER_ID,
    updateBy: SYSTEM_USER_ID,
  });

  console.log("[Seed] System user created with ID:", SYSTEM_USER_ID);
};

// Cron Jobs
export const startCronJobs = async () => {
  console.log("[Seed] Setting up cron jobs...");

  // Sports: every 24 hours at midnight UTC
  // cron.schedule(
  //   "0 0 * * *",
  //   () => {
  //     console.log("[Seed] Running scheduled sports sync...");
  //     syncSports();
  //   },
  //   { timezone: "UTC" },
  // );

  // Competitions: every 12 hours
  cron.schedule(
    "0 */12 * * *",
    () => {
      console.log("[Seed] Running scheduled competitions sync...");
      syncCompetitions();
    },
    { timezone: "UTC" },
  );

  // Events: every 12 hours — sync events for all active competitions
  cron.schedule(
    "0 */12 * * *",
    () => {
      console.log("[Seed] Running scheduled events sync...");
      syncAllActiveCompetitionEvents();
    },
    { timezone: "UTC" },
  );

  console.log("[Seed] Cron jobs started: Sports daily 00:00 UTC, Competitions every 12h, Events every 30m");

  // Run initial sync immediately
  console.log("[Seed] Running initial sync...");
  // await syncSports();
  await syncCompetitions();
  await syncAllActiveCompetitionEvents();
  console.log("[Seed] Initial sync completed!");
};

// Manual run functions
export const runAll = async () => {
  console.log("Starting manual sync...");
  await syncSports();
  await syncCompetitions();
  console.log("Manual sync completed!");
};

// Manual execution
// if (import.meta.main) {
//   runAll()
//     .then(() => {
//       console.log("Manual execution completed!");
//       process.exit(0);
//     })
//     .catch((error) => {
//       console.error("Manual execution failed:", error);
//       process.exit(1);
//     });
// }

export { syncSports, syncCompetitions };
