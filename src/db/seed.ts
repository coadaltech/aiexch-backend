import { db } from "./index";
import { sports, competitions, users, SYSTEM_USER_ID } from "./schema";
import { eq } from "drizzle-orm";
import { UserRole } from "../types/enums";
import { generateHashPassword } from "../utils/password";
import cron from "node-cron";
import { syncAllActiveCompetitionEvents, ensureRacingCompetitions, syncRacingEvents } from "../services/event-sync-service";
import { buildAllEventSnapshots } from "../services/event-snapshot-service";
import { BetfairService } from "../services/betfair";
import { NotepadBuilder } from "../services/notepad-builder";

// API Configuration
// ── DEPRECATED: legacy provider for event-types/competitions. Replaced by Betfair.
const API_BASE_URL = "https://api.aiexch.com/Soe81s9017b44b6d822da257xk055b11/sports";

// ── ID remappings: API returns one ID but competitions live under a different ID ─
const SPORT_ID_REMAPPINGS: Record<number, number> = {
  2378961: 500, // Election — API event ID is 2378961, but competitions are fetched under 500
};

// ── Display-name overrides keyed by sport_id ──────────────────────────────────
// Enforce a rename in the DB regardless of what the external API returns or what
// MANUAL_SPORTS lists, so no manual migration is needed. Mirrors the frontend
// SPORT_DISPLAY_NAME_OVERRIDES in lib/sports-config.ts — keep the two in sync.
const SPORT_NAME_OVERRIDES: Record<number, string> = {
  500: "Election", // was "Politics"
  1005: "Bombay Bazar", // was "Bombay Bazar"
};

const applyNameOverride = (sportId: number, name: string): string =>
  SPORT_NAME_OVERRIDES[sportId] ?? name;

// ── Manually managed sports that are not returned by the external API ──────────
const MANUAL_SPORTS = [
  { sport_id: 1001, name: "Matka" },
  { sport_id: 1002, name: "Lottery" },
  { sport_id: 1003, name: "Skill Games" },
  { sport_id: 1004, name: "Jambo" },
  { sport_id: 1005, name: "Bombay Bazar" },
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

// Get event types (sports) from Betfair (listEventTypes).
// Betfair returns [{ eventType: { id, name }, marketCount }] — which upsertSport
// already understands via sportData.eventType?.id / .name.
const getSportsFromApi = async () => {
  try {
    console.log("Fetching event types from Betfair...");
    const data = await BetfairService.listEventTypes();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Failed to fetch event types from Betfair:", error);
    return [];
  }

  // ── DEPRECATED: legacy provider fetch (api.aiexch.com/.../eventtypes) ──────
  // try {
  //   console.log("Fetching sports from API...");
  //   const data = await fetchApi(`${API_BASE_URL}/eventtypes`);
  //   if (Array.isArray(data)) return data;
  //   else if (data.data && Array.isArray(data.data)) return data.data;
  //   else if (data.eventTypes && Array.isArray(data.eventTypes)) return data.eventTypes;
  //   else { console.error("Unknown API response format:", data); return []; }
  // } catch (error) {
  //   console.error("Failed to fetch sports from API:", error);
  //   return [];
  // }
};

// Get competitions for a sport from Betfair (listCompetitions).
// Betfair returns [{ competition: { id, name }, marketCount }] — understood by
// upsertCompetition via compData.competition.id / .name.
const getCompetitionsFromApi = async (sportId: number) => {
  try {
    console.log(`Fetching competitions for event type ID: ${sportId}...`);
    const data = await BetfairService.listCompetitions(sportId);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Failed to fetch competitions for sport ${sportId}:`, error);
    return [];
  }

  // ── DEPRECATED: legacy provider fetch (api.aiexch.com/.../competitions/list) ─
  // try {
  //   console.log(`Fetching competitions for sport ID: ${sportId}...`);
  //   const data = await fetchApi(`${API_BASE_URL}/competitions/list/${sportId}`);
  //   if (Array.isArray(data)) return data;
  //   else if (data.data && Array.isArray(data.data)) return data.data;
  //   else if (data.competitions && Array.isArray(data.competitions)) return data.competitions;
  //   else if (data.competition && Array.isArray(data.competition)) return data.competition;
  //   else { console.error(`Unknown competitions API response format for sport ${sportId}:`, data); return []; }
  // } catch (error) {
  //   console.error(`Failed to fetch competitions for sport ${sportId}:`, error);
  //   return [];
  // }
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
    const sportName = applyNameOverride(
      Number(sportId),
      sportData.name ||
        sportData.eventTypeName ||
        sportData.eventType?.name ||
        "Unknown Sport",
    );

    if (!sportId) {
      console.log("Skipping sport - missing ID:", sportData);
      return { operation: "skipped", reason: "missing_id" };
    }

    const existing = await db
      .select()
      .from(sports)
      .where(eq(sports.sport_id, Number(sportId)))
      .limit(1);

    let operationType = "";

    if (existing.length > 0) {
      // PRESERVE owner-controlled fields (is_active, is_live, is_highlight,
      // sort_order) on re-sync — only refresh the display name. Re-running the
      // sync must NOT wipe what the owner toggled in the panel.
      await db
        .update(sports)
        .set({ name: sportName, updateBy: SYSTEM_USER_ID, updateDate: new Date() })
        .where(eq(sports.sport_id, Number(sportId)));
      operationType = "updated";
      console.log(`Updated sport name: ${sportName} (ID: ${sportId})`);
    } else {
      // New sport — default inactive so an admin must explicitly enable it.
      await db.insert(sports).values({
        sport_id: Number(sportId),
        name: sportName,
        is_active: false,
        sort_order: sportData.sortOrder || sportData.sort_order || 0,
        addedBy: SYSTEM_USER_ID,
        addedDate: new Date(),
        updateBy: SYSTEM_USER_ID,
        updateDate: new Date(),
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

// Upsert MANUAL_SPORTS only — safe to call standalone (preserves is_active on
// existing rows; new rows default to inactive so an admin must explicitly enable).
const syncManualSports = async () => {
  for (const manual of MANUAL_SPORTS) {
    const name = applyNameOverride(manual.sport_id, manual.name);
    try {
      const existing = await db
        .select()
        .from(sports)
        .where(eq(sports.sport_id, manual.sport_id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(sports)
          .set({ name, updateBy: SYSTEM_USER_ID, updateDate: new Date() })
          .where(eq(sports.sport_id, manual.sport_id));
        console.log(`Manual sport updated: ${name} (ID: ${manual.sport_id})`);
      } else {
        await db.insert(sports).values({
          sport_id: manual.sport_id,
          name,
          is_active: false,
          sort_order: 0,
          addedBy: SYSTEM_USER_ID,
          addedDate: new Date(),
          updateBy: SYSTEM_USER_ID,
          updateDate: new Date(),
        });
        console.log(`Manual sport added: ${name} (ID: ${manual.sport_id})`);
      }
    } catch (err: any) {
      console.error(`Error upserting manual sport ${name}:`, err.message);
    }
  }
};

// Force the display name of any renamed sport that already lives in the DB
// (e.g. Politics → Election, id 500, which is seeded from the external API and
// so is not covered by MANUAL_SPORTS). Only updates rows that already exist —
// never creates one — and leaves is_active untouched.
const applySportNameOverrides = async () => {
  for (const [idStr, name] of Object.entries(SPORT_NAME_OVERRIDES)) {
    const sportId = Number(idStr);
    try {
      const existing = await db
        .select({ sport_id: sports.sport_id })
        .from(sports)
        .where(eq(sports.sport_id, sportId))
        .limit(1);
      if (existing.length === 0) continue;

      await db
        .update(sports)
        .set({ name, updateBy: SYSTEM_USER_ID, updateDate: new Date() })
        .where(eq(sports.sport_id, sportId));
      console.log(`Sport name override applied: ${name} (ID: ${sportId})`);
    } catch (err: any) {
      console.error(`Error applying name override for sport ${sportId}:`, err.message);
    }
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

    await syncManualSports();
    await applySportNameOverrides();

    // Refresh the sports-list display notepad (names may have changed).
    await NotepadBuilder.buildSportsListNotepad();

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

    // Racing sports (Horse/Greyhound) have no Betfair competitions — create their
    // synthetic competitions here so they show up in the competitions list too.
    await ensureRacingCompetitions();

    console.log(
      `Competitions sync done — Sports: ${totalSports} | Competitions: ${totalCompetitions} | Added: ${totalAdded} | Updated: ${totalUpdated} | Errors: ${totalErrors}`,
    );

    // Refresh the sports-list display notepad (racing synthetic comps may be new).
    await NotepadBuilder.buildSportsListNotepad();

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

  // Manual sports (matka, jambo, lottery, bombay-bazar, etc.): every 12 hours
  // Safe to run on cron — preserves is_active on existing rows.
  cron.schedule(
    "0 */12 * * *",
    async () => {
      console.log("[Seed] Running scheduled manual sports sync...");
      await syncManualSports();
      await applySportNameOverrides();
    },
    { timezone: "UTC" },
  );

  // Competitions: every 24 hours at 00:30 UTC (from Betfair)
  cron.schedule(
    "30 0 * * *",
    () => {
      console.log("[Seed] Running scheduled competitions sync...");
      syncCompetitions();
    },
    { timezone: "UTC" },
  );

  // Events: every 24 hours at 01:00 UTC — sync events for all active competitions (from Betfair)
  cron.schedule(
    "0 1 * * *",
    () => {
      console.log("[Seed] Running scheduled events sync...");
      syncAllActiveCompetitionEvents();
    },
    { timezone: "UTC" },
  );

  // Racing (Horse/Greyhound): every minute. Racing has no competition layer and
  // races open/finish all day, so a daily sync is useless here — this short cycle
  // adds new races, drops finished ones, and inactivates completed meetings.
  // Lightweight (1 listEvents + a chunked listMarketCatalogue per sport); the
  // in-flight guard skips a tick if the previous run is still going.
  let racingSyncRunning = false;
  cron.schedule(
    "* * * * *",
    async () => {
      if (racingSyncRunning) {
        console.log("[Seed] Racing sync still running — skipping this tick");
        return;
      }
      racingSyncRunning = true;
      try {
        await syncRacingEvents();
      } catch (err) {
        console.error("[Seed] Racing sync error:", err);
      } finally {
        racingSyncRunning = false;
      }
    },
    { timezone: "UTC" },
  );

  // Event snapshots: rebuild every day at 01:30 UTC (AFTER the 01:00 events
  // sync, so today's events exist in the DB). Pre-fetches each today-event's
  // markets+odds into event-snapshots/<eventId> so the match page's first paint
  // is instant (served from the file) — no loading spinner. The live WebSocket
  // refreshes prices on top.
  cron.schedule(
    "30 1 * * *",
    async () => {
      console.log("[Seed] Running daily event-snapshot rebuild...");
      await buildAllEventSnapshots();
    },
    { timezone: "UTC" },
  );

  console.log(
    "[Seed] Cron jobs started: Manual sports every 12h, Competitions daily 00:30 UTC, Events daily 01:00 UTC, Racing every 1m, Event snapshots daily 01:30 UTC (event-types fetched manually via syncSports)",
  );

  // ── No external fetch/sync on restart ──────────────────────────────────────
  // Per product decision: event-types are fetched manually; competitions + events
  // are fetched once a day by the crons above (and on-demand from the owner panel
  // buttons). We only ensure the local "manual" sports (matka/lottery/etc.) rows
  // exist — this is a local upsert, NOT an external fetch.
  console.log("[Seed] Ensuring manual sports exist (no external sync on boot)...");
  await syncManualSports();
  await applySportNameOverrides();
  // NOTE: syncSports() / syncCompetitions() / syncAllActiveCompetitionEvents()
  // are intentionally NOT called here — they run on cron / via owner-panel buttons.

  // Build the event snapshots once now (background, non-blocking) so a freshly
  // started server serves instant first paints without waiting for the daily
  // cron. Self-paced (concurrency-limited) so it doesn't stall boot.
  void buildAllEventSnapshots();
};

// Manual run functions
export const runAll = async () => {
  console.log("Starting manual sync...");
  await syncSports();
  await syncManualSports();
  await applySportNameOverrides();
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

export { syncSports, syncCompetitions, syncManualSports, applySportNameOverrides };
