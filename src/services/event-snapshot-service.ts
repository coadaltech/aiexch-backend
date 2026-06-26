import { db } from "@db/index";
import { events, competitions } from "@db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { SportsService } from "./sports";
import { writeNotepad, readNotepad, removeNotepadFile } from "./notepad";

/**
 * Event-snapshot pre-fetch — eliminates the "loading" on first open.
 *
 * A cold open must hit Betfair (listMarketCatalogue + listMarketBook), and that
 * round-trip is ~3-5s from our server. So instead of fetching on open, we
 * pre-fetch every TODAY event's markets+odds ONCE (at boot, and once a day) and
 * write a per-event file under `event-snapshots/<eventId>.json`. The match page's
 * REST first-paint (getMatchDetails) serves that file instantly, then the live
 * WebSocket takes over with fresh prices — so the user never sees a spinner.
 *
 * Design notes (carefully avoiding flicker / data disappearing):
 *   - The snapshot stores the SAME shape getMatchDetails returns, so serving it
 *     is a passthrough.
 *   - We only WRITE non-empty snapshots, and on a refresh we never delete a
 *     today-event's file just because a transient fetch came back empty — so a
 *     good first-paint snapshot is never replaced by nothing.
 *   - Stale files (events no longer in today's set) are removed via a manifest,
 *     and only AFTER the new files are written, so there's never a gap.
 */

const SNAP_DIR = "event-snapshots";
const MANIFEST_KEY = "event-snapshots-manifest";

export const eventSnapshotKey = (eventId: string | number) =>
  `${SNAP_DIR}/${eventId}`;

const RACING_SPORT_IDS = new Set([7, 4339]);
const CONCURRENCY = Number(process.env.SNAPSHOT_CONCURRENCY || 5);

let building = false;

/** UTC start/end of "today" — events are scoped to today's date. */
function todayWindowUtc(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
  );
  return { start, end };
}

/** Active events (under an active competition) whose openDate is today. */
async function listTodaysEvents(): Promise<{ eventId: number; sportId: number }[]> {
  const { start, end } = todayWindowUtc();
  const rows = await db
    .select({ eventId: events.eventId, sportId: events.sportId })
    .from(events)
    .innerJoin(competitions, eq(competitions.competition_id, events.competitionId))
    .where(
      and(
        eq(events.isActive, true),
        eq(competitions.is_active, true),
        gte(events.openDate, start),
        lte(events.openDate, end),
      ),
    );
  return rows.map((r) => ({
    eventId: Number(r.eventId),
    sportId: Number(r.sportId),
  }));
}

/**
 * Build (and write) one event's snapshot. Returns true if a non-empty snapshot
 * was written. Never writes an empty snapshot — that would let WS-vs-snapshot
 * races blank the page.
 */
export async function buildEventSnapshot(
  eventId: number | string,
  sportId: number | string,
): Promise<boolean> {
  try {
    const isRacing = RACING_SPORT_IDS.has(Number(sportId));
    const marketOddsData = await SportsService.getMarketsWithOdds({
      eventId: String(eventId),
      eventTypeId: String(sportId),
    });
    if (!Array.isArray(marketOddsData) || marketOddsData.length === 0) {
      return false; // nothing to show yet (e.g. markets not open) — leave any prior file intact
    }
    const snapshot = {
      matchOdds: marketOddsData,
      score: null,
      premiumFancy: null,
      bookmakers: null,
      sessions: null,
      showLay: !isRacing,
    };
    await writeNotepad(eventSnapshotKey(eventId), snapshot, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-build snapshots for every TODAY event. Runs at boot and once a day.
 * Concurrency-limited so we don't hammer Betfair. Cleans up yesterday's files
 * AFTER the new ones are written (no gap).
 */
export async function buildAllEventSnapshots(): Promise<void> {
  if (building) {
    console.log("[Snapshot] Build already in progress — skipping");
    return;
  }
  building = true;
  const startedAt = Date.now();
  try {
    const items = await listTodaysEvents();
    if (items.length === 0) {
      console.log("[Snapshot] No today-events to snapshot");
    }

    let built = 0;
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const it = items[i++];
        if (await buildEventSnapshot(it.eventId, it.sportId)) built++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker),
    );

    // Remove stale snapshots (events from a previous build that aren't in
    // today's set) — only AFTER today's files exist, so there's never a gap.
    const todayIds = items.map((it) => String(it.eventId));
    const todaySet = new Set(todayIds);
    const oldManifest = await readNotepad<string[]>(MANIFEST_KEY);
    for (const oldId of oldManifest?.data ?? []) {
      if (!todaySet.has(String(oldId))) {
        await removeNotepadFile(eventSnapshotKey(oldId));
      }
    }
    await writeNotepad(MANIFEST_KEY, todayIds, { quiet: true });

    console.log(
      `[Snapshot] Built ${built}/${items.length} event snapshot(s) in ${Date.now() - startedAt}ms`,
    );
  } catch (err: any) {
    console.error("[Snapshot] Build failed:", err?.message);
  } finally {
    building = false;
  }
}
