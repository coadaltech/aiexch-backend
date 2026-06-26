import { db } from "@db/index";
import { events, competitions, sports, SYSTEM_USER_ID } from "@db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { SportsService } from "./sports";
import { writeNotepad } from "./notepad";
import { NotepadBuilder } from "./notepad-builder";
import { BetfairService } from "./betfair";

// Betfair event types that have NO competition layer — events are fetched
// directly under the event type (each event = a race meeting / venue-day).
export const RACING_EVENT_TYPE_IDS = [7, 4339]; // Horse Racing, Greyhound Racing

// Synthetic competition id per racing sport so racing events satisfy the
// NOT NULL events.competition_id. 9e9 base is well above Betfair's id range.
const SYNTHETIC_COMP_BASE = 9_000_000_000;
export const racingCompetitionId = (sportId: number) =>
  SYNTHETIC_COMP_BASE + sportId;


/**
 * Sync events (matches) from external API into the DB for a given competition.
 * - Upserts events by eventId
 * - Does NOT overwrite admin-set fields (isActive, betDelay, etc.) on existing rows
 * - Fetches the "Match Odds" market and stores its ID as defaultMarketId for new events
 */
export async function syncEventsForCompetition(
  competitionId: number,
  sportId: number,
) {
  try {
    // Fetch matches from external API (reuse SportsService which handles caching)
    const matchData = await SportsService.getMatchList({
      eventTypeId: String(sportId),
      competitionId: String(competitionId),
    });

    if (!matchData || matchData.length === 0) {
      console.log(`[EventSync] No events found for competition ${competitionId}`);
      return { synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;

    for (const match of matchData) {
      const eventId = match.id || match.event?.id;
      if (!eventId) continue;

      try {
        const existing = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.eventId, Number(eventId)))
          .limit(1);

        if (existing.length > 0) {
          // Update only name/openDate — don't touch admin-set fields
          await db
            .update(events)
            .set({
              name: match.name || match.event?.name || "",
              openDate: match.openDate ? new Date(match.openDate) : undefined,
            })
            .where(eq(events.eventId, Number(eventId)));
          synced++;
        } else {
          // New event — also fetch its default market
          let defaultMarketId: string | null = null;
          try {
            const markets = await SportsService.getMarkets({ eventId: String(eventId) });
            const matchOdds = markets?.find(
              (m: any) =>
                m.marketName === "Match Odds" ||
                m.marketType === "MATCH_ODDS",
            );
            if (matchOdds?.marketId) {
              defaultMarketId = String(matchOdds.marketId);
            }
          } catch {
            // Non-fatal: market fetch can fail for upcoming events
          }

          await db.insert(events).values({
            eventId: Number(eventId),
            competitionId: Number(competitionId),
            sportId: Number(sportId),
            name: match.name || match.event?.name || "Unknown Event",
            openDate: match.openDate ? new Date(match.openDate) : undefined,
            defaultMarketId,
            isActive: true,
            isVisible: true,
            suspended: false,
            betDelay: 0,
          });
          synced++;
        }
      } catch (err) {
        console.error(`[EventSync] Error syncing event ${eventId}:`, err);
        errors++;
      }
    }

    console.log(
      `[EventSync] Competition ${competitionId}: synced ${synced}, errors ${errors}`,
    );

    // Refresh the display notepad so the owner-panel per-competition fetch updates.
    await NotepadBuilder.regenSportNotepad(Number(sportId));
    return { synced, errors };
  } catch (error) {
    console.error(`[EventSync] Failed for competition ${competitionId}:`, error);
    return { synced: 0, errors: 1 };
  }
}

/**
 * Deactivate all events for a competition (when competition is turned off).
 */
export async function deactivateEventsForCompetition(competitionId: number) {
  try {
    await db
      .update(events)
      .set({ isActive: false })
      .where(eq(events.competitionId, competitionId));

    console.log(`[EventSync] Deactivated events for competition ${competitionId}`);
  } catch (error) {
    console.error(`[EventSync] Failed to deactivate events for competition ${competitionId}:`, error);
  }
}

/**
 * Ensure the synthetic competition row exists for a racing sport (idempotent).
 * Racing has no Betfair competition layer, but events.competition_id is NOT NULL,
 * so each racing sport gets one synthetic competition that its meetings sit under.
 * Returns the synthetic competition id.
 */
export async function ensureRacingCompetition(sportId: number): Promise<number> {
  const compId = racingCompetitionId(sportId);
  const existing = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.competition_id, compId))
    .limit(1);
  if (existing.length === 0) {
    const [sportRow] = await db
      .select({ name: sports.name })
      .from(sports)
      .where(eq(sports.sport_id, sportId))
      .limit(1);
    const sportName =
      sportRow?.name ?? (sportId === 7 ? "Horse Racing" : "Greyhound Racing");
    await db.insert(competitions).values({
      competition_id: compId,
      sport_id: sportId,
      name: sportName,
      provider: "BETFAIR",
      is_active: true, // racing meetings should show by default
      addedBy: SYSTEM_USER_ID,
      updateBy: SYSTEM_USER_ID,
    });
    console.log(
      `[RacingSync] Created synthetic competition ${compId} (${sportName})`,
    );
  }
  return compId;
}

/** Ensure synthetic competitions for ALL racing sports. Called by competitions sync. */
export async function ensureRacingCompetitions() {
  for (const sportId of RACING_EVENT_TYPE_IDS) {
    await ensureRacingCompetition(sportId);
  }
}

/**
 * Sync RACING events (Horse/Greyhound) which have no competition layer.
 * For each racing sport: ensure a synthetic competition exists, fetch meetings
 * directly via listEvents(eventTypeId), upsert them under the synthetic comp
 * (preserving countryCode/venue/timezone in metadata for the racing UI), and
 * write a `racing-<sportId>` notepad of meetings grouped-ready for display.
 */
export async function syncRacingEvents() {
  for (const sportId of RACING_EVENT_TYPE_IDS) {
    try {
      const compId = await ensureRacingCompetition(sportId);

      // Fetch meetings directly (no competition filter).
      const evs = await BetfairService.listEvents(sportId);
      const meetings: any[] = [];
      for (const e of evs as any[]) {
        const ev = e.event;
        if (!ev?.id) continue;
        const eventId = Number(ev.id);
        const meta = {
          countryCode: ev.countryCode ?? null,
          venue: ev.venue ?? null,
          timezone: ev.timezone ?? null,
        };

        const existing = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.eventId, eventId))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(events)
            .set({
              name: ev.name,
              openDate: ev.openDate ? new Date(ev.openDate) : undefined,
              metadata: meta,
            })
            .where(eq(events.eventId, eventId));
        } else {
          await db.insert(events).values({
            eventId,
            competitionId: compId,
            sportId,
            name: ev.name ?? "Race Meeting",
            openDate: ev.openDate ? new Date(ev.openDate) : undefined,
            metadata: meta,
            isActive: true,
            isVisible: true,
            suspended: false,
            betDelay: 0,
          });
        }

        meetings.push({
          eventId,
          name: ev.name,
          venue: ev.venue ?? null,
          countryCode: ev.countryCode ?? null,
          timezone: ev.timezone ?? null,
          openDate: ev.openDate ?? null,
          marketCount: e.marketCount ?? 0,
          races: [] as { marketId: string; name: string; raceTime: string | null }[],
        });
      }

      // Fetch every meeting's races (WIN markets + start times) in one batched
      // call, then attach to each meeting so the racing page renders all the
      // race-time buttons from the notepad (no per-meeting fetch on the client).
      try {
        const racesByEvent = await BetfairService.listRacesForEvents(
          meetings.map((m) => String(m.eventId)),
        );
        for (const m of meetings) {
          m.races = racesByEvent[String(m.eventId)] ?? [];
        }
      } catch (err: any) {
        console.error(`[RacingSync] races fetch failed for sport ${sportId}:`, err?.message);
      }

      meetings.sort((a, b) =>
        String(a.openDate ?? "").localeCompare(String(b.openDate ?? "")),
      );
      await writeNotepad(`racing-${sportId}`, meetings);
      console.log(
        `[RacingSync] sport ${sportId}: ${meetings.length} meetings`,
      );
    } catch (err: any) {
      console.error(`[RacingSync] Failed for sport ${sportId}:`, err?.message);
    }
  }
  await NotepadBuilder.buildSportsListNotepad();
}

/**
 * Sync events for ALL active competitions. Called by cron.
 */
export async function syncAllActiveCompetitionEvents() {
  try {
    const activeComps = await db
      .select({
        competition_id: competitions.competition_id,
        sport_id: competitions.sport_id,
      })
      .from(competitions)
      .where(eq(competitions.is_active, true));

    console.log(`[EventSync] Syncing events for ${activeComps.length} active competitions`);

    let totalSynced = 0;
    let totalErrors = 0;

    for (const comp of activeComps) {
      const result = await syncEventsForCompetition(comp.competition_id, comp.sport_id);
      totalSynced += result.synced;
      totalErrors += result.errors;
    }

    console.log(
      `[EventSync] Full sync done: ${totalSynced} events synced, ${totalErrors} errors`,
    );

    // Racing sports have no competition layer — sync them directly.
    await syncRacingEvents();

    // Rebuild the display notepad (sports-list + per-whitelabel series) the reads serve.
    await NotepadBuilder.rebuildAllNotepad();
  } catch (error) {
    console.error("[EventSync] Full sync failed:", error);
  }
}
