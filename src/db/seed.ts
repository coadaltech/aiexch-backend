import { db } from "./index";
import { sports, competitions } from "./schema";
import { eq } from "drizzle-orm";
import cron from "node-cron";

// API Configuration
const API_BASE_URL = "https://api.aiexch.com/sports-proxy/sports";

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
    console.log("🌐 Fetching sports from API...");
    const data = await fetchApi(`${API_BASE_URL}/eventtypes`);

    // Check response structure
    console.log("API Response structure:", Object.keys(data));

    // Handle different response formats
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
const getCompetitionsFromApi = async (sportId: string) => {
  try {
    console.log(`🌐 Fetching competitions for sport ID: ${sportId}...`);
    const data = await fetchApi(`${API_BASE_URL}/competitions/list/${sportId}`);

    // Check response structure
    console.log(
      `Competitions API response for sport ${sportId}:`,
      Object.keys(data),
    );

    // Handle different response formats
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
    console.log("Processing sport data:", JSON.stringify(sportData, null, 2));

    // Extract sport ID and name from different possible fields
    const sportId =
      sportData.id ||
      sportData.eventTypeId ||
      sportData.sport_id ||
      sportData.eventType?.id;
    const sportName =
      sportData.name ||
      sportData.eventTypeName ||
      sportData.eventType?.name ||
      "Unknown Sport";

    if (!sportId) {
      console.log("❌ Skipping sport - missing ID:", sportData);
      return { operation: "skipped", reason: "missing_id" };
    }

    if (!sportName) {
      console.log("⚠️ Sport has no name, using default:", sportId);
    }

    const existing = await db
      .select()
      .from(sports)
      .where(eq(sports.sport_id, Number(sportId)))
      .limit(1);

    const sportToSave = {
      sport_id: Number(sportId),
      name: sportName,
      is_active:  false, // Default to false
      sort_order: sportData.sortOrder || sportData.sort_order || 0,
      metadata: sportData.metadata || {},
      updateDate: new Date(),
    };

    let operationType = "";

    if (existing.length > 0) {
      await db
        .update(sports)
        .set(sportToSave)
        .where(eq(sports.sport_id, Number(sportId)));
      operationType = "updated";
      console.log(`📝 Updated sport: ${sportName} (ID: ${sportId})`);
    } else {
      await db.insert(sports).values({
        ...sportToSave,
        addedDate: new Date(),
      });
      operationType = "added";
      console.log(`✅ Added new sport: ${sportName} (ID: ${sportId})`);
    }

    return { operation: operationType, sportId: Number(sportId), sportName };
  } catch (error) {
    console.error("Error upserting sport:", error, sportData);
    return { operation: "error", error: error.message };
  }
};

const upsertCompetition = async (compData: any, sportId: string) => {
  try {
    // Extract competition data from different possible structures
    const competition = compData.competition || compData;

    const compId = competition.id || compData.competitionId || compData.id;
    const compName =
      competition.name ||
      compData.name ||
      compData.competitionName ||
      "Unknown Competition";
    const provider = competition.provider || compData.provider || "BETFAIR";

    if (!compId) {
      console.log("❌ Skipping competition - missing ID:", compData);
      return { operation: "skipped", reason: "missing_id" };
    }

    // Check existing competitons in db
    const existing = await db
      .select()
      .from(competitions)
      .where(eq(competitions.competition_id, Number(compId)))
      .limit(1);

    // skip existing competitions
    if (existing.length > 0) {
      console.log(
        `⏭️ Skipping existing competition: ${compName} (ID: ${compId})`,
      );
      return {
        operation: "skipped",
        reason: "already_exists",
        competitionId: Number(compId),
        competitionName: compName,
      };
    }

    // ✅ inser only new competitons
    const isActive = false; // Default false
    const metadata = competition.metadata || compData.metadata || {};

    await db.insert(competitions).values({
      competition_id: Number(compId),
      sport_id: Number(sportId),
      name: compName,
      provider: provider,
      is_active: isActive,
      is_archived: competition.isArchived || compData.isArchived || false,
      metadata: metadata,
      addedDate: new Date(),
      updateDate: new Date(),
    });

    console.log(`✅ Added NEW competition: ${compName} (ID: ${compId})`);

    return {
      operation: "added",
      competitionId: Number(compId),
      competitionName: compName,
    };
  } catch (error) {
    console.error("Error upserting competition:", error, compData);
    return { operation: "error", error: error.message };
  }
};

// Sync Functions
const syncSports = async () => {
  console.log("🚀 Starting sports sync...");

  try {
    const sportsData = await getSportsFromApi();
    console.log(`📥 Received ${sportsData.length} sports from API`);

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

    console.log("🎯 Sports sync completed!");
    console.log(`   • Total processed: ${sportsData.length}`);
    console.log(`   • Newly added: ${addedCount}`);
    console.log(`   • Updated: ${updatedCount}`);
    console.log(`   • Errors: ${errorCount}`);

    return {
      total: sportsData.length,
      added: addedCount,
      updated: updatedCount,
      errors: errorCount,
    };
  } catch (error) {
    console.error("❌ Sports sync failed:", error);
    return { total: 0, added: 0, updated: 0, errors: 1 };
  }
};

const syncCompetitions = async () => {
  console.log("🚀 Starting competitions sync...");

  try {
    // Get all active sports from DB
    const dbSports = await db
      .select()
      .from(sports)

    console.log(`📊 Found ${dbSports.length} active sports in database`);

    let totalCompetitions = 0;
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const totalSports = dbSports.length;

    for (let i = 0; i < dbSports.length; i++) {
      const sport = dbSports[i];
      const sportNumber = i + 1;

      console.log(
        `\n📊 Processing sport ${sportNumber}/${totalSports}: ${sport.name} (ID: ${sport.sport_id})`,
      );

      // if(sport.id !== "2") continue;
      // if (sport.sport_id !== "2") continue;

      try {
        const competitionsData = await getCompetitionsFromApi(sport.sport_id);
        console.log(
          `   📥 Received ${competitionsData.length} competitions from API`,
        );

        if (competitionsData.length === 0) {
          console.log(`   ⚠️ No competitions found for ${sport.name}`);
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

        // ✅ YEH WALA CONSOLE ADD KARNA HAI
        console.log(`   ✅ Sport "${sport.name}" all competitions added!`);
        console.log(
          `      ↳ Total: ${competitionsData.length} | New: ${sportAdded} | Updated: ${sportUpdated} | Errors: ${sportErrors}`,
        );
      } catch (sportError) {
        console.error(
          `   ❌ Error processing sport ${sport.name}:`,
          sportError,
        );
        totalErrors++;
      }
    }

    // Final summary
    console.log("\n🎯 ALL SPORTS SYNC COMPLETED!");
    console.log("=".repeat(50));
    console.log(`   • Total sports processed: ${totalSports}`);
    console.log(`   • Total competitions processed: ${totalCompetitions}`);
    console.log(`   • Newly added competitions: ${totalAdded}`);
    console.log(`   • Updated competitions: ${totalUpdated}`);
    console.log(`   • Total errors: ${totalErrors}`);
    console.log("=".repeat(50));

    return {
      totalSports,
      totalCompetitions,
      added: totalAdded,
      updated: totalUpdated,
      errors: totalErrors,
    };
  } catch (error) {
    console.error("❌ Competitions sync failed:", error);
    return {
      totalSports: 0,
      totalCompetitions: 0,
      added: 0,
      updated: 0,
      errors: 1,
    };
  }
};

// Cron Jobs
export const startCronJobs = async () => {  
  console.log("⏰ Setting up cron jobs...");

  // Sports: हर 24 घंटे में (midnight UTC)
  cron.schedule(
    "0 0 * * *",
    () => {
      console.log("⏰ Running scheduled sports sync...");
      syncSports();
    },
    {
      timezone: "UTC",
    },
  );

  // Competitions: हर 12 घंटे में
  cron.schedule(
    "0 */12 * * *",
    () => {
      console.log("⏰ Running scheduled competitions sync...");
      syncCompetitions();
    },
    {
      timezone: "UTC",
    },
  );

  console.log("✅ Cron jobs started:");
  console.log("   • Sports sync: Daily at 00:00 UTC");
  console.log("   • Competitions sync: Every 12 hours");

  // Run initial sync immediately
  console.log("\n🚀 Running initial sync...");
  console.log("-".repeat(40));
  await syncSports();
  console.log("-".repeat(40));
  await syncCompetitions();
  console.log("-".repeat(40));
  console.log("✅ Initial sync completed!");
};

// Manual run functions
export const runAll = async () => {
  console.log("🚀 Starting manual sync...");
  console.log("=".repeat(50));
  await syncSports();
  console.log("-".repeat(50));
  await syncCompetitions();
  console.log("=".repeat(50));
  console.log("🎯 Manual sync completed!");
};


// File: sports-sync.ts (अंत में जोड़ें)

// Manual execution
if (import.meta.main) {
  console.log("🔄 Manual execution started...");
  
  // सभी sync चलाएं
  runAll().then(() => {
    console.log("✅ Manual execution completed!");
    process.exit(0);
  }).catch((error) => {
    console.error("❌ Manual execution failed:", error);
    process.exit(1);
  });
}

export { syncSports, syncCompetitions };
