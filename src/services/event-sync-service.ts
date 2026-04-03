import { db } from "@db/index";
import { events, competitions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { SportsService } from "./sports";

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
  } catch (error) {
    console.error("[EventSync] Full sync failed:", error);
  }
}
