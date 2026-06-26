import axios from "axios";
import type { MarketItem } from "../types/sports/lists";

/**
 * Betfair Exchange API client.
 *
 * Auth model (https://identitysso.betfair.com):
 *   - login   → POST /api/login      (username + password + X-Application appkey) → session token
 *   - keepAlive → POST /api/keepAlive (X-Authentication: token)  → resets idle timer
 *   Session expiry: 12h (.com non-UK/IE), 24h (UK/IE). Any betting API call also
 *   resets the timer, so for our constantly-polling engine keepAlive is just an
 *   idle backstop (e.g. overnight).
 *
 * Betting API (https://api.betfair.com/exchange/betting/rest/v1.0):
 *   listEventTypes / listCompetitions / listEvents / listMarketCatalogue / listMarketBook
 *   All POST, JSON body, headers X-Application + X-Authentication.
 *
 * Credentials come from env (never hardcoded):
 *   BETFAIR_APP_KEY, BETFAIR_USERNAME, BETFAIR_PASSWORD
 *   BETFAIR_IDENTITY_URL (default https://identitysso.betfair.com/api)
 *   BETFAIR_BETTING_URL  (default https://api.betfair.com/exchange/betting/rest/v1.0)
 *   BETFAIR_KEEPALIVE_MS (default 6h)
 */

const APP_KEY = process.env.BETFAIR_APP_KEY || "";
const USERNAME = process.env.BETFAIR_USERNAME || "";
const PASSWORD = process.env.BETFAIR_PASSWORD || "";
const IDENTITY_URL =
  process.env.BETFAIR_IDENTITY_URL || "https://identitysso.betfair.com/api";
const BETTING_URL =
  process.env.BETFAIR_BETTING_URL ||
  "https://api.betfair.com/exchange/betting/rest/v1.0";
export const BETFAIR_KEEPALIVE_MS = Number(
  process.env.BETFAIR_KEEPALIVE_MS || 6 * 60 * 60 * 1000,
);

// ── Session state (per-process). For multi-instance you may later centralise
//    this token in Redis so all instances share one login. Kept in-memory for now. ─
let sessionToken: string | null = null;
let loginInFlight: Promise<string> | null = null;

const identity = axios.create({ baseURL: IDENTITY_URL, timeout: 10_000 });
const betting = axios.create({ baseURL: BETTING_URL, timeout: 10_000 });

function assertConfigured() {
  if (!APP_KEY || !USERNAME || !PASSWORD) {
    throw new Error(
      "[Betfair] Missing credentials — set BETFAIR_APP_KEY, BETFAIR_USERNAME, BETFAIR_PASSWORD",
    );
  }
}

/** Interactive login → returns a session token. */
async function login(): Promise<string> {
  assertConfigured();
  const body = new URLSearchParams({ username: USERNAME, password: PASSWORD });
  const res = await identity.post("/login", body.toString(), {
    headers: {
      "X-Application": APP_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  const data = res.data || {};
  if (data.status !== "SUCCESS" || !data.token) {
    throw new Error(
      `[Betfair] Login failed: status=${data.status} error=${data.error}`,
    );
  }
  sessionToken = data.token as string;
  console.log("[Betfair] Logged in, session established");
  return sessionToken;
}

/** Returns a valid token, logging in if necessary (deduped). */
async function ensureSession(): Promise<string> {
  if (sessionToken) return sessionToken;
  if (!loginInFlight) {
    loginInFlight = login().finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

/** Keep the session alive (idle backstop). Safe to call on a timer. */
export async function keepAlive(): Promise<boolean> {
  try {
    if (!sessionToken) {
      await ensureSession();
      return true;
    }
    const res = await identity.post("/keepAlive", null, {
      headers: {
        "X-Application": APP_KEY,
        "X-Authentication": sessionToken,
        Accept: "application/json",
      },
    });
    if (res.data?.status !== "SUCCESS") {
      console.warn(`[Betfair] keepAlive non-success: ${res.data?.status}`);
      sessionToken = null; // force re-login next call
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn("[Betfair] keepAlive error:", err?.message);
    sessionToken = null;
    return false;
  }
}

/**
 * POST a betting operation with auth, re-logging-in once on session errors.
 */
async function request<T = any>(operation: string, body: object): Promise<T> {
  const token = await ensureSession();

  const send = (tok: string) =>
    betting.post<T>(`/${operation}/`, body, {
      headers: {
        "X-Application": APP_KEY,
        "X-Authentication": tok,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

  try {
    const res = await send(token);
    return res.data;
  } catch (err: any) {
    // Betfair returns INVALID_SESSION_INFORMATION / NO_SESSION on expiry.
    const detail = err?.response?.data?.detail?.APINGException?.errorCode;
    const status = err?.response?.status;
    const expired =
      status === 401 ||
      detail === "INVALID_SESSION_INFORMATION" ||
      detail === "NO_SESSION";
    if (expired) {
      sessionToken = null;
      const fresh = await ensureSession();
      const res = await send(fresh);
      return res.data;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing operations (used by the 24h sync + manual event-type sync)
// ─────────────────────────────────────────────────────────────────────────────

/** [{ eventType: { id, name }, marketCount }] */
export async function listEventTypes(filter: object = {}) {
  return request<any[]>("listEventTypes", { filter });
}

/** [{ competition: { id, name }, marketCount, competitionRegion }] */
export async function listCompetitions(eventTypeId: string | number) {
  return request<any[]>("listCompetitions", {
    filter: { eventTypeIds: [String(eventTypeId)] },
  });
}

/** [{ event: { id, name, openDate, ... }, marketCount }] */
export async function listEvents(
  eventTypeId: string | number,
  competitionId?: string | number,
) {
  const filter: any = { eventTypeIds: [String(eventTypeId)] };
  if (competitionId != null) filter.competitionIds = [String(competitionId)];
  return request<any[]>("listEvents", { filter });
}

/** Raw market catalogue for an event (structure + runners + types). */
export async function listMarketCatalogue(eventId: string | number) {
  return request<any[]>("listMarketCatalogue", {
    filter: { eventIds: [String(eventId)] },
    marketProjection: [
      "MARKET_DESCRIPTION",
      "RUNNER_DESCRIPTION",
      "EVENT",
      "COMPETITION",
      "MARKET_START_TIME",
    ],
    sort: "FIRST_TO_START",
    maxResults: "100",
  });
}

/**
 * Race markets for MANY meeting events in one call (used by racing sync).
 * Returns each meeting's WIN races with their start times, grouped by eventId:
 *   { [eventId]: [{ marketId, name, raceTime }] }  (sorted by raceTime)
 * WIN markets only (the race itself); PLACE / "To Be Placed" markets are excluded.
 */
export async function listRacesForEvents(
  eventIds: string[],
): Promise<Record<string, { marketId: string; name: string; raceTime: string | null }[]>> {
  const out: Record<string, { marketId: string; name: string; raceTime: string | null }[]> = {};
  if (!eventIds.length) return out;

  // Filter to WIN markets SERVER-SIDE (marketTypeCodes) and use a light
  // projection — MARKET_DESCRIPTION is heavy and blows past Betfair's per-request
  // data-weight cap (that's what 400'd before). Chunk events as a safety margin.
  const CHUNK = 10;
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    chunks.push(eventIds.slice(i, i + CHUNK).map(String));
  }

  const results = await Promise.all(
    chunks.map((ids) =>
      request<any[]>("listMarketCatalogue", {
        filter: { eventIds: ids, marketTypeCodes: ["WIN"] },
        marketProjection: ["MARKET_START_TIME", "EVENT"],
        sort: "FIRST_TO_START",
        maxResults: "1000",
      }).catch((err: any) => {
        console.warn("[Betfair] listRacesForEvents chunk failed:", err?.message);
        return [] as any[];
      }),
    ),
  );

  for (const markets of results) {
    for (const m of markets || []) {
      const eid = String(m.event?.id ?? "");
      if (!eid) continue;
      (out[eid] ??= []).push({
        marketId: String(m.marketId),
        name: m.marketName || "",
        raceTime: m.marketStartTime || null,
      });
    }
  }
  for (const eid of Object.keys(out)) {
    out[eid].sort((a, b) =>
      String(a.raceTime ?? "").localeCompare(String(b.raceTime ?? "")),
    );
  }
  return out;
}

/** Raw market book (live prices) for the given market IDs. */
export async function listMarketBook(marketIds: string[]) {
  return request<any[]>("listMarketBook", {
    marketIds,
    priceProjection: {
      priceData: ["EX_BEST_OFFERS"],
      exBestOffersOverrides: {
        bestPricesDepth: 3,
        rollupModel: "STAKE",
        // rollupLimit must be SMALL — at 20, Betfair aggregates price levels whose
        // size is under 20 (common: sizes like 2.56/1.79) into one entry, so only
        // 1 back/lay shows. 1 keeps the 3 distinct best prices.
        rollupLimit: 1,
      },
      virtualise: true,
      rolloverStakes: false,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers → translate Betfair shapes into the shapes the rest of the app expects
// ─────────────────────────────────────────────────────────────────────────────

/** Betfair listMarketCatalogue → MarketItem[] (same shape as current provider's catalogues). */
export function mapCatalogueToMarketItems(catalogue: any[]): MarketItem[] {
  if (!Array.isArray(catalogue)) return [];
  return catalogue.map((m: any) => {
    const desc = m.description || {};
    return {
      marketId: String(m.marketId),
      marketTime: m.marketStartTime || desc.marketTime || null,
      marketType: desc.marketType || "MATCH_ODDS",
      // Keep Betfair's real bettingType. LINE markets stay LINE so the rest of the
      // system (bet validation = 1 runner ok, fancy settlement, fancy odds
      // conversion) treats them as fancy. `isLineMarket` flags Betfair LINE markets
      // ONLY for display grouping ("Betfair Fancy", separate from old sessions).
      bettingType: desc.bettingType || "ODDS",
      isLineMarket: desc.bettingType === "LINE",
      marketName: m.marketName || "",
      provider: "BETFAIR",
      // "sportingEvent" = ball-running suspension (a cricket concept). It does
      // NOT apply to Betfair markets — the frontend reads true as "suspended".
      // Real suspension comes from the market status in listMarketBook.
      sportingEvent: false,
      marketCondition: {
        marketId: String(m.marketId),
        betLock: false,
        minBet: 0,
        maxBet: 0,
        maxProfit: 0,
        betDelay: 0,
        mtp: 0,
        allowUnmatchBet: false,
        potLimit: 0,
        volume: m.totalMatched ?? 0,
      },
      // Catalogue has no live status — default OPEN; the market book drives suspension.
      status: "OPEN",
      inPlay: false,
      sortPriority: 0,
      runners: Array.isArray(m.runners)
        ? m.runners.map((r: any) => ({
            id: r.selectionId,
            name: r.runnerName,
            sortPriority: r.sortPriority ?? 0,
            metadata: r.metadata
              ? { runnerId: String(r.selectionId) }
              : null,
          }))
        : [],
      odds: null,
    } as unknown as MarketItem;
  });
}

/**
 * Betfair listMarketBook → odds object keyed by marketId, in the SAME shape the
 * current provider's /sports/books returns, so live-data-service needs no changes:
 *   { [marketId]: { marketId, status, inPlay, betDelay, runners: [{ selectionId, status, back:[[price,size]], lay:[[price,size]], pnl }] } }
 */
export function mapBookToOdds(book: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!Array.isArray(book)) return out;
  for (const mb of book) {
    out[String(mb.marketId)] = {
      marketId: String(mb.marketId),
      status: mb.status, // OPEN | SUSPENDED | CLOSED | INACTIVE
      inPlay: !!mb.inplay,
      betDelay: mb.betDelay ?? 0,
      lastMatchTime: mb.lastMatchTime ?? null,
      updateTime: Date.now(),
      // Not ball-running — Betfair signals suspension via `status`, not this flag.
      sportingEvent: false,
      runners: Array.isArray(mb.runners)
        ? mb.runners.map((r: any) => ({
            selectionId: r.selectionId,
            status: r.status, // ACTIVE | WINNER | LOSER | REMOVED
            // The frontend reads each price level as { price, size } objects (it
            // accesses item.price / item.size). Betfair already returns objects in
            // availableToBack/Lay (best price first), so keep that shape.
            back: (r.ex?.availableToBack || []).map((o: any) => ({
              price: o.price,
              size: o.size,
            })),
            lay: (r.ex?.availableToLay || []).map((o: any) => ({
              price: o.price,
              size: o.size,
            })),
            pnl: 0,
          }))
        : [],
    };
  }
  return out;
}

/** Fetch + map live odds for Betfair market IDs (chunked + per-chunk resilient). */
export async function getOddsForMarketIds(
  marketIds: string[],
): Promise<Record<string, any>> {
  if (!marketIds.length) return {};

  // listMarketBook has a per-request data limit (EX_BEST_OFFERS weight + response
  // size). Markets with MANY runners (e.g. "1st Innings Runs" ~55 runners) make a
  // chunk exceed it → Betfair rejects the whole call and those markets get no odds.
  // Adaptive: try a chunk; on failure SPLIT and retry until each piece fits.
  const fetchBook = async (ids: string[]): Promise<any[]> => {
    try {
      return await listMarketBook(ids);
    } catch (err: any) {
      if (ids.length <= 1) {
        console.warn(`[Betfair] listMarketBook failed for ${ids[0]}:`, err?.message);
        return [];
      }
      const mid = Math.ceil(ids.length / 2);
      const [a, b] = await Promise.all([
        fetchBook(ids.slice(0, mid)),
        fetchBook(ids.slice(mid)),
      ]);
      return [...a, ...b];
    }
  };

  const CHUNK = 25;
  const chunks: string[][] = [];
  for (let i = 0; i < marketIds.length; i += CHUNK) {
    chunks.push(marketIds.slice(i, i + CHUNK));
  }
  const allBooks = (await Promise.all(chunks.map(fetchBook))).flat();
  return mapBookToOdds(allBooks);
}

export const BetfairService = {
  login,
  ensureSession,
  keepAlive,
  listEventTypes,
  listCompetitions,
  listEvents,
  listMarketCatalogue,
  listRacesForEvents,
  listMarketBook,
  mapCatalogueToMarketItems,
  mapBookToOdds,
  getOddsForMarketIds,
};
