// services/match-list-snapshot-service.ts
//
// Builds a COMBINED "events + their default-market odds" snapshot per sport and
// writes it to a single notepad file. The homepage / in-play match lists read
// this one file to paint EVERY row at once, instead of revealing rows one-by-one
// as each event's odds trickle in over the per-event WebSocket poll loop.
//
// Why a shared server-side loop (not per-client work):
//   - The /ws/markets feed streams odds PER EVENT, each event on its own poll
//     loop, so a list's rows become visible one at a time (the "loads one by
//     one" effect). A precomputed snapshot gives the client a full, ordered set
//     of events+odds in a single fetch → the whole list appears together.
//   - One background loop produces the file; thousands of clients just read it.
//     Cost is O(sports), not O(users) — no per-user backend load.
//
// Freshness: the snapshot is only the INITIAL paint + membership source. Once a
// list mounts, /ws/markets streams fresher odds over the top, so a few seconds
// of snapshot staleness is invisible. New in-play events appear (and finished
// ones drop) on the next rebuild.

import { SportsService } from "./sports";
import { readNotepad, writeNotepad } from "./notepad";
import { getInPlaySet } from "./inplay-sync-service";

/** Sports whose match lists render as a 1/X/2 odds list (cricket, soccer,
 *  tennis, election). Racing (7/4339) is a many-runner WIN market with its own
 *  page, and manual sports (matka/lottery/…) have no live odds — both excluded.
 *  Override with SNAPSHOT_EVENT_TYPE_IDS="4,1,2,500". */
export const SNAPSHOT_EVENT_TYPE_IDS: string[] = (
  process.env.SNAPSHOT_EVENT_TYPE_IDS || "4,1,2,500"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Rebuild cadence. The snapshot is just the instant-paint seed (WS streams the
// live odds afterwards), so this can be relaxed; 5s keeps "new in-play appears"
// snappy without hammering the odds provider.
const SNAPSHOT_REFRESH_MS = Number(process.env.SNAPSHOT_REFRESH_MS || 5000);

// Odds only exist for live / soon-to-start events, so we bound the snapshot to a
// window around now (a SUPERSET of the client's 3-day display window) plus any
// in-play match. Election (500) shows every market regardless of date, so it is
// never windowed. Keeps the per-cycle listMarketBook calls small.
// Must stay ≥ the frontend's DATE_WINDOW_DAYS (currently 7) so every event the
// list can display exists in the snapshot file. Kept a day wider as margin.
const WINDOW_AHEAD_MS = 8 * 24 * 60 * 60 * 1000; // 8 days ahead
const WINDOW_BEHIND_MS = 2 * 24 * 60 * 60 * 1000; // 2 days behind (long live events)
const NO_WINDOW_EVENT_TYPES = new Set(["500"]);

export interface MatchListSnapshotItem {
  id: string;
  name: string;
  openDate: string | null;
  status: string;
  inPlay: boolean;
  defaultMarketId: string;
  seriesId: string;
  seriesName: string;
  betCount: number;
  // The default market's current odds (mapBookToOdds shape: runners[].back/lay
  // are [{price,size}] arrays). null until the market has prices.
  market: any | null;
}

/** Notepad path for a sport's combined match-list snapshot. */
export const matchListSnapshotPath = (eventTypeId: string | number) =>
  `matchlist/${eventTypeId}`;

let loopRunning = false;
let cycleInFlight = false;

/**
 * Build (and persist) the combined events+odds snapshot for one sport. Returns
 * the freshly built item list. Whitelabel-agnostic / anonymous (global view):
 * the file is a shared instant-paint seed; per-user betCount and any
 * whitelabel-specific visibility are still applied client-side via the existing
 * per-user matches-list fetch.
 */
export async function buildMatchListSnapshot(
  eventTypeId: string,
): Promise<MatchListSnapshotItem[]> {
  // Flat match list (global, anon) — same SQL the per-user matches-list uses.
  const matches = await SportsService.getMatchesWithDefaultMarkets(eventTypeId);

  const now = Date.now();
  const windowed = !NO_WINDOW_EVENT_TYPES.has(String(eventTypeId));
  const inWindow = (m: any): boolean => {
    if (!windowed) return true;
    if (m.inPlay) return true;
    if (!m.openDate) return true;
    const t = new Date(m.openDate).getTime();
    if (isNaN(t)) return true;
    return t >= now - WINDOW_BEHIND_MS && t <= now + WINDOW_AHEAD_MS;
  };

  const relevant = matches.filter(inWindow);

  // One batched odds fetch for every default market we'll display. getOdds
  // routes "1.x" ids to Betfair listMarketBook (chunked + adaptive) and other
  // ids to the legacy provider, then merges — a single shared call per sport.
  const marketIds = Array.from(
    new Set(
      relevant
        .map((m: any) => m.defaultMarketId)
        .filter((id: any) => id != null && id !== ""),
    ),
  ).map(String);

  const odds = marketIds.length
    ? await SportsService.getOdds({ marketId: marketIds })
    : {};

  // Authoritative in-play set from the hourly Betfair reconciliation (null until
  // the first run completes — then we trust live market status / the DB flag).
  const inPlaySet = getInPlaySet(eventTypeId);

  // Resolve the TRUE in-play state for a row so the In-Play page stays fresh:
  //   • a CLOSED / settled default market → finished → not in-play (drops it,
  //     refreshed every snapshot cycle so completions clear within seconds);
  //   • else a live market (book says inplay) → in-play;
  //   • else the hourly Betfair in-play set (membership backstop);
  //   • else the DB `open_date <= now()` heuristic as a last resort.
  const resolveInPlay = (m: any, market: any | null): boolean => {
    const status = market?.status;
    if (status === "CLOSED" || status === "INACTIVE") return false;
    if (market?.inPlay === true) return true;
    if (inPlaySet) return inPlaySet.has(String(m.id));
    return !!m.inPlay;
  };

  const data: MatchListSnapshotItem[] = relevant.map((m: any) => {
    const market = m.defaultMarketId
      ? odds[String(m.defaultMarketId)] ?? null
      : null;
    return {
      id: String(m.id),
      name: m.name,
      openDate: m.openDate ?? null,
      status: m.status,
      inPlay: resolveInPlay(m, market),
      defaultMarketId: String(m.defaultMarketId ?? ""),
      seriesId: String(m.seriesId ?? ""),
      seriesName: m.seriesName ?? "",
      betCount: 0, // per-user; filled client-side from the authenticated list
      market,
    };
  });

  await writeNotepad(matchListSnapshotPath(eventTypeId), data, { quiet: true });
  return data;
}

/**
 * Read a sport's snapshot from the notepad. Falls back to building it on demand
 * (and caching) if the file doesn't exist yet — so the first request before the
 * loop has warmed still returns data instead of an empty list.
 */
export async function readMatchListSnapshot(
  eventTypeId: string,
): Promise<{ updatedAt: string; data: MatchListSnapshotItem[] } | null> {
  const np = await readNotepad<MatchListSnapshotItem[]>(
    matchListSnapshotPath(eventTypeId),
  );
  if (np?.data) return np;
  // No file yet. Only build on-demand for sports the loop actually maintains —
  // otherwise an arbitrary eventTypeId could trigger a heavy odds fetch on the
  // request path. Unsupported sports just return null (the client falls back to
  // its per-user list + WS, i.e. the previous behaviour).
  if (!SNAPSHOT_EVENT_TYPE_IDS.includes(String(eventTypeId))) return null;
  try {
    const data = await buildMatchListSnapshot(eventTypeId);
    return { updatedAt: new Date().toISOString(), data };
  } catch (err: any) {
    console.error(
      `[MatchListSnapshot] On-demand build failed for ${eventTypeId}:`,
      err?.message,
    );
    return null;
  }
}

/** Rebuild every configured sport's snapshot once (sequential, resilient). */
async function runCycle(): Promise<void> {
  if (cycleInFlight) return; // never overlap cycles
  cycleInFlight = true;
  try {
    for (const eventTypeId of SNAPSHOT_EVENT_TYPE_IDS) {
      try {
        await buildMatchListSnapshot(eventTypeId);
      } catch (err: any) {
        console.error(
          `[MatchListSnapshot] build failed for ${eventTypeId}:`,
          err?.message,
        );
      }
    }
  } finally {
    cycleInFlight = false;
  }
}

/** Start the background refresh loop (idempotent). Builds once immediately. */
export function startMatchListSnapshotLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  void runCycle();
  setInterval(() => void runCycle(), SNAPSHOT_REFRESH_MS);
  console.log(
    `[MatchListSnapshot] Loop started — sports [${SNAPSHOT_EVENT_TYPE_IDS.join(
      ", ",
    )}] every ${SNAPSHOT_REFRESH_MS}ms`,
  );
}

export const MatchListSnapshotService = {
  SNAPSHOT_EVENT_TYPE_IDS,
  matchListSnapshotPath,
  buildMatchListSnapshot,
  readMatchListSnapshot,
  startMatchListSnapshotLoop,
};
