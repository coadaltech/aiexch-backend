// services/inplay-sync-service.ts
//
// Periodically asks Betfair which events are CURRENTLY in-play (per sport) and
// keeps that set in memory so the match-list snapshot can mark the right rows
// as live — so newly in-play matches appear on the In-Play page and finished
// ones drop off, instead of relying on the stale `open_date <= now()` heuristic
// in the DB (which never clears once a match starts).
//
// Why a shared hourly loop: "which events are in-play" is the same for everyone,
// so one background reconciliation feeds all clients — no per-user work. The
// snapshot loop additionally uses each market's live status (CLOSED / inplay)
// every few seconds, so completed matches drop promptly between hourly runs;
// this hourly set is the authoritative membership backstop.

import { BetfairService } from "./betfair";
import { readNotepad, writeNotepad } from "./notepad";

/** Sports to reconcile — same default set the snapshot maintains. Override with
 *  INPLAY_SYNC_EVENT_TYPE_IDS (falls back to SNAPSHOT_EVENT_TYPE_IDS). */
export const INPLAY_SYNC_EVENT_TYPE_IDS: string[] = (
  process.env.INPLAY_SYNC_EVENT_TYPE_IDS ||
  process.env.SNAPSHOT_EVENT_TYPE_IDS ||
  "4,1,2,500"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// As requested: refresh from Betfair every hour. Configurable for tuning.
const INPLAY_SYNC_REFRESH_MS = Number(
  process.env.INPLAY_SYNC_REFRESH_MS || 60 * 60 * 1000,
);

const inPlaySetPath = (eventTypeId: string | number) =>
  `inplay-events/${eventTypeId}`;

// sportId → set of in-play event ids. In-process cache shared with the snapshot
// builder (same process). Persisted to the notepad so a restart warms instantly.
const inPlaySets = new Map<string, Set<string>>();
let loopRunning = false;
let cycleInFlight = false;

/**
 * The current in-play event-id set for a sport, or null if we have no data yet
 * (caller should then fall back to live market status / the DB heuristic). null
 * vs. empty-set is meaningful: empty means "Betfair says nothing is live".
 */
export function getInPlaySet(eventTypeId: string | number): Set<string> | null {
  return inPlaySets.get(String(eventTypeId)) ?? null;
}

/** Warm the in-memory sets from the last persisted snapshot (post-restart). */
async function loadPersisted(): Promise<void> {
  for (const eventTypeId of INPLAY_SYNC_EVENT_TYPE_IDS) {
    try {
      const np = await readNotepad<string[]>(inPlaySetPath(eventTypeId));
      if (np?.data) inPlaySets.set(String(eventTypeId), new Set(np.data));
    } catch {
      /* best-effort warm load */
    }
  }
}

/** One reconciliation pass over every configured sport (resilient per-sport). */
async function runCycle(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    for (const eventTypeId of INPLAY_SYNC_EVENT_TYPE_IDS) {
      try {
        const ids = await BetfairService.listInPlayEventIds(eventTypeId);
        inPlaySets.set(String(eventTypeId), new Set(ids));
        await writeNotepad(inPlaySetPath(eventTypeId), ids, { quiet: true });
        console.log(
          `[InPlaySync] sport ${eventTypeId}: ${ids.length} in-play event(s)`,
        );
      } catch (err: any) {
        // Keep the previous set on failure — don't blank the page on a hiccup.
        console.error(
          `[InPlaySync] refresh failed for ${eventTypeId}:`,
          err?.message,
        );
      }
    }
  } finally {
    cycleInFlight = false;
  }
}

/** Start the hourly reconciliation loop (idempotent). Warms + refreshes once. */
export function startInPlaySyncLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  void (async () => {
    await loadPersisted();
    await runCycle();
  })();
  setInterval(() => void runCycle(), INPLAY_SYNC_REFRESH_MS);
  console.log(
    `[InPlaySync] Loop started — sports [${INPLAY_SYNC_EVENT_TYPE_IDS.join(
      ", ",
    )}] every ${INPLAY_SYNC_REFRESH_MS}ms`,
  );
}

export const InPlaySyncService = {
  INPLAY_SYNC_EVENT_TYPE_IDS,
  getInPlaySet,
  startInPlaySyncLoop,
};
