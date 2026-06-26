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
 *
 * Racing is time-sensitive: meetings and individual races open and finish all
 * day long, so this runs on a short cron (see startCronJobs), NOT once a day.
 *
 * How "completed" is detected — no extra status call needed:
 *   • listEvents(eventTypeId) only returns meetings that still have OPEN markets;
 *     a meeting whose races are all done drops out of the response entirely.
 *   • listMarketCatalogue (listRacesForEvents) never returns CLOSED markets, so a
 *     finished race simply disappears from a meeting's race list once it settles.
 * Each cycle we therefore treat "has at least one open WIN race" as live, mark
 * everything else under the racing competition inactive, and write a notepad that
 * contains ONLY meetings that still have races (empty meetings are never shown).
 */
export async function syncRacingEvents() {
  for (const sportId of RACING_EVENT_TYPE_IDS) {
    try {
      const compId = await ensureRacingCompetition(sportId);

      // Fetch meetings directly (no competition filter).
      const evs = await BetfairService.listEvents(sportId);
      if (!Array.isArray(evs)) {
        // Defensive: a malformed/empty response shouldn't wipe active meetings.
        console.warn(`[RacingSync] sport ${sportId}: listEvents returned no array, skipping`);
        continue;
      }

      const meetings: any[] = [];
      for (const e of evs as any[]) {
        const ev = e.event;
        if (!ev?.id) continue;
        meetings.push({
          eventId: Number(ev.id),
          name: ev.name ?? "Race Meeting",
          venue: ev.venue ?? null,
          countryCode: ev.countryCode ?? null,
          timezone: ev.timezone ?? null,
          openDate: ev.openDate ?? null,
          marketCount: e.marketCount ?? 0,
          races: [] as { marketId: string; name: string; raceTime: string | null }[],
        });
      }

      // Attach each meeting's open WIN races (start times) in one batched call.
      // A finished race is already gone from this response — that's our signal.
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

      // A meeting is "live" only while it still has at least one open race.
      const liveMeetings = meetings.filter((m) => m.races.length > 0);
      const liveIds = liveMeetings.map((m) => m.eventId);

      // Upsert every meeting we saw (name/openDate/metadata). New rows start
      // active only if they currently have open races.
      for (const m of meetings) {
        const meta = {
          countryCode: m.countryCode,
          venue: m.venue,
          timezone: m.timezone,
        };
        const existing = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.eventId, m.eventId))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(events)
            .set({
              name: m.name,
              openDate: m.openDate ? new Date(m.openDate) : undefined,
              metadata: meta,
            })
            .where(eq(events.eventId, m.eventId));
        } else {
          await db.insert(events).values({
            eventId: m.eventId,
            competitionId: compId,
            sportId,
            name: m.name,
            openDate: m.openDate ? new Date(m.openDate) : undefined,
            metadata: meta,
            isActive: m.races.length > 0,
            isVisible: true,
            suspended: false,
            betDelay: 0,
          });
        }
      }

      // Reconcile active flags for this racing competition: meetings with open
      // races are active; everything else (finished today, or dropped out of
      // listEvents entirely) is deactivated. This is "inactivate completed
      // races" for racing — it runs every cycle.
      if (liveIds.length > 0) {
        await db
          .update(events)
          .set({ isActive: true })
          .where(
            and(
              eq(events.competitionId, compId),
              inArray(events.eventId, liveIds),
              eq(events.isActive, false),
            ),
          );
        await db
          .update(events)
          .set({ isActive: false })
          .where(
            and(
              eq(events.competitionId, compId),
              notInArray(events.eventId, liveIds),
              eq(events.isActive, true),
            ),
          );
      } else {
        // Nothing running for this sport right now → deactivate all its meetings.
        await db
          .update(events)
          .set({ isActive: false })
          .where(and(eq(events.competitionId, compId), eq(events.isActive, true)));
      }

      // Notepad holds ONLY meetings that still have races, so the racing page
      // never renders an empty venue.
      liveMeetings.sort((a, b) =>
        String(a.openDate ?? "").localeCompare(String(b.openDate ?? "")),
      );
      await writeNotepad(`racing-${sportId}`, liveMeetings);
      console.log(
        `[RacingSync] sport ${sportId}: ${liveMeetings.length} live meetings (${meetings.length} seen)`,
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
