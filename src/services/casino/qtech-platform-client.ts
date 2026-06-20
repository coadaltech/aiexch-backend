/**
 * QTech Platform Client (outbound — WE call QT's Services API)
 *
 * Implements the calls the Operator makes INTO the QT Platform, per the
 * Common Wallet Integration Manual v2.52:
 *   - §4.1 Authentication  → POST /v1/auth/token  (query-param credentials)
 *   - §8.1 Game List       → GET  /v2/games
 *   - §5.1 Game Launcher   → POST /v1/games/{gameId}/launch-url
 *
 * This is the read/launch side that powers the casino lobby in the frontend.
 * It is separate from the Common Wallet callbacks (qtech-common-wallet.ts),
 * which is the money side QT calls back into us.
 *
 * Env:
 *   QT_PLATFORM_BASE_URL  e.g. https://api-int.qtplatform.com (staging)
 *   QT_PLATFORM_USERNAME  api user (api_aiexch)
 *   QT_PLATFORM_PASSWORD  api password
 *   QT_RETURN_URL         default return URL embedded in launch requests
 *
 * Token caching: /v1/auth/token returns expires_in in milliseconds (~6h).
 * We cache in-process and refresh 5 minutes before expiry.
 *
 * NOTE: QT whitelists our outbound IP. Direct calls succeed from the
 * whitelisted prod server; from a non-whitelisted local box QT will reject
 * the connection — the lobby will then surface an upstream error.
 */
import axios, { AxiosInstance } from "axios";

const BASE_URL = (process.env.QT_PLATFORM_BASE_URL || "").replace(/\/$/, "");
const USERNAME = process.env.QT_PLATFORM_USERNAME || "";
const PASSWORD = process.env.QT_PLATFORM_PASSWORD || "";

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

// ── Token cache (§4.1) ─────────────────────────────────────────────────────
type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;
let inflightTokenPromise: Promise<string> | null = null;
const REFRESH_LEAD_MS = 5 * 60 * 1000;

async function fetchFreshToken(): Promise<string> {
  if (!BASE_URL) throw new Error("[QTech] QT_PLATFORM_BASE_URL is not set");
  if (!USERNAME || !PASSWORD)
    throw new Error("[QTech] QT_PLATFORM_USERNAME or QT_PLATFORM_PASSWORD is not set");

  // Credentials go in the query string (manual §4.1).
  const { data } = await http.post<{ access_token: string; expires_in: number }>(
    "/v1/auth/token",
    null,
    {
      params: {
        grant_type: "password",
        response_type: "token",
        username: USERNAME,
        password: PASSWORD,
      },
    },
  );

  if (!data?.access_token)
    throw new Error(`[QTech] /v1/auth/token returned no access_token: ${JSON.stringify(data)}`);

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 60_000) - REFRESH_LEAD_MS,
  };
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  if (inflightTokenPromise) return inflightTokenPromise;
  inflightTokenPromise = fetchFreshToken().finally(() => (inflightTokenPromise = null));
  return inflightTokenPromise;
}

function invalidateToken() {
  cachedToken = null;
}

// Authed request with a single 401 retry (token may have expired).
async function authed<T>(
  method: "get" | "post",
  path: string,
  opts: { params?: Record<string, unknown>; data?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const run = async (token: string) => {
    const res = await http.request<T>({
      method,
      url: path,
      params: opts.params,
      data: opts.data,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    return res.data;
  };
  try {
    return await run(await getAccessToken());
  } catch (err: any) {
    if (err?.response?.status === 401) {
      invalidateToken();
      return run(await getAccessToken());
    }
    throw err;
  }
}

// ── Game List (§8.1) ───────────────────────────────────────────────────────
// Raw QT shapes (only the fields we use).
type QtNamed = { id: string; name: string };
type QtImage = { type: string; url: string };
interface QtGame {
  id: string;
  name: string;
  provider?: QtNamed;
  description?: string;
  currencies?: QtNamed[];
  supportedDevices?: QtNamed[] | string[];
  clientTypes?: string[];
  category?: string;
  demoSupport?: boolean;
  freeRoundSupport?: boolean;
  images?: QtImage[];
}
// Pagination is cursor-based (§8.1): the response carries a `links` array whose
// `next` entry holds the relative URL (with a `cursor` query param) for the
// following page. The `links` element is absent once the last page is reached.
type QtLink = { href: string; rel: string; method?: string; name?: string };
interface QtGameListResponse {
  totalCount: number | string;
  items: QtGame[];
  links?: QtLink[];
}

/** Clean shape returned to the frontend lobby. */
export interface QtechLobbyGame {
  id: string;
  name: string;
  provider: string;
  category: string | null;
  currencies: string[];
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  demoSupport: boolean;
}

function pickImage(images: QtImage[] | undefined, type: string): string | null {
  return images?.find((i) => i.type === type)?.url ?? null;
}

export interface ListGamesOptions {
  /** Per-page size for the QT request. We loop pages until the full catalogue
   *  is collected, so this is NOT a cap on the total — just the batch size. */
  size?: number;
  providers?: string;
  currencies?: string;
  gameTypes?: string;
  acceptLanguage?: string;
}

// QT's /v2/games is cursor-paginated (§8.1): we request a page, then follow the
// `next` link's cursor until no `next` link remains. 1000 is QT's documented max
// page size, so this is the fewest round-trips. MAX_PAGES is just a runaway
// guard (1000 × 1000 = 1M games, far above any real catalogue).
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

// The `next` link href is a relative URL like "/v2/games?cursor=<opaque>".
// Pull the decoded cursor back out so we can re-send it as a query param.
function nextCursor(links: QtLink[] | undefined): string | null {
  const next = links?.find((l) => l.rel === "next");
  if (!next?.href) return null;
  try {
    return new URL(next.href, "https://qt").searchParams.get("cursor");
  } catch {
    return null;
  }
}

function mapGame(g: QtGame): QtechLobbyGame {
  return {
    id: g.id,
    name: g.name,
    provider: g.provider?.name || g.provider?.id || "",
    category: g.category ?? null,
    currencies: (g.currencies || []).map((c) => (typeof c === "string" ? c : c.id)),
    // logo-square is the 1:1 tile art; fall back to logo-round then banner.
    thumbnailUrl:
      pickImage(g.images, "logo-square") ||
      pickImage(g.images, "logo-round") ||
      pickImage(g.images, "banner"),
    bannerUrl: pickImage(g.images, "banner"),
    demoSupport: Boolean(g.demoSupport),
  };
}

// Shared query params for /v2/games. Most-popular first (§8.1: popularity sort
// must pair with orderBy=DESC); the cursor pagination preserves this order
// across pages.
function buildListParams(opts: ListGamesOptions, pageSize: number) {
  return {
    size: pageSize,
    sortBy: "popularity",
    orderBy: "DESC",
    ...(opts.providers ? { providers: opts.providers } : {}),
    ...(opts.currencies ? { currencies: opts.currencies } : {}),
    ...(opts.gameTypes ? { gameTypes: opts.gameTypes } : {}),
  };
}

export interface GamesPage {
  totalCount: number;
  games: QtechLobbyGame[];
  /** Opaque cursor for the following page, or null on the last page. */
  nextCursor: string | null;
}

/**
 * Fetch a SINGLE page of the catalogue (§8.1) plus the cursor for the next page.
 *
 * This is one round-trip to QT, so it returns fast and never risks the long
 * multi-page walk in listGames(). The lobby uses it for infinite scroll: it
 * loads the first page on open, then pulls further pages as the user scrolls or
 * switches category — so the initial paint is quick and there is no timeout.
 */
export async function listGamesPage(
  opts: ListGamesOptions & { cursor?: string | null } = {},
): Promise<GamesPage> {
  const pageSize = opts.size ?? PAGE_SIZE;
  const data = await authed<QtGameListResponse>("get", "/v2/games", {
    params: {
      ...buildListParams(opts, pageSize),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
    },
    headers: { "Accept-Language": opts.acceptLanguage || "en-US" },
  });

  // Dedupe by id as a belt-and-braces guard against any overlap within a page.
  const byId = new Map<string, QtechLobbyGame>();
  for (const g of data.items || []) byId.set(g.id, mapGame(g));

  return {
    totalCount: Number(data.totalCount) || byId.size,
    games: Array.from(byId.values()),
    nextCursor: nextCursor(data.links),
  };
}

/**
 * Collect the ENTIRE catalogue by walking every cursor page. This is the heavy
 * call (one HTTP round-trip per page, ~13k games today) — use it for offline
 * sync jobs, NOT request paths. The lobby uses listGamesPage() instead.
 */
export async function listGames(opts: ListGamesOptions = {}): Promise<{
  totalCount: number;
  games: QtechLobbyGame[];
}> {
  // Dedupe by id as a belt-and-braces guard against any overlap between pages.
  const byId = new Map<string, QtechLobbyGame>();
  let totalCount = 0;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listGamesPage({ ...opts, cursor });
    for (const g of res.games) byId.set(g.id, g);
    totalCount = res.totalCount || totalCount;

    // Advance to the next page; absence of a `next` cursor means we're done.
    cursor = res.nextCursor;
    if (!cursor) break;
  }

  const games = Array.from(byId.values());
  return { totalCount: totalCount || games.length, games };
}

// ── Game Launcher (§5.1) ───────────────────────────────────────────────────
export interface LaunchUrlRequest {
  gameId: string;
  /** "demo" (no wallet needed) or "real" (requires walletSessionId). */
  mode?: "demo" | "real";
  currency?: string;
  lang?: string;
  device?: "desktop" | "mobile";
  country?: string;
  returnUrl?: string;
  // real-money only:
  playerId?: string;
  walletSessionId?: string;
}

export async function getLaunchUrl(req: LaunchUrlRequest): Promise<{ url: string }> {
  const mode = req.mode || "demo";
  const body: Record<string, unknown> = {
    currency: req.currency || "USD",
    lang: req.lang || "en_US",
    mode,
    device: req.device || "desktop",
    returnUrl: req.returnUrl || process.env.QT_RETURN_URL || "",
  };
  // playerId, country and walletSessionId are not required in demo mode (§5.1).
  if (mode === "real") {
    body.playerId = req.playerId;
    body.country = req.country || "CN";
    body.walletSessionId = req.walletSessionId;
  }
  return authed<{ url: string }>("post", `/v1/games/${encodeURIComponent(req.gameId)}/launch-url`, {
    data: body,
  });
}

export function clientInfo() {
  return {
    baseUrl: BASE_URL || "(unset)",
    hasUsername: Boolean(USERNAME),
    hasPassword: Boolean(PASSWORD),
    tokenCached: Boolean(cachedToken),
    tokenExpiresAt: cachedToken?.expiresAt ?? null,
  };
}
