/**
 * Ace Gamings Platform Client (outbound)
 *
 * Wraps the inbound endpoints we call on Ace: auth, games catalog, launch URL.
 *
 * Base URL resolution (CASINO_PLATFORM_BASE_URL):
 *   - In production, point directly at Ace:
 *       https://staging-op-api.acegamings.com/api/operator/e_w/v1
 *   - In local development, point at the dev proxy hosted on your
 *     whitelisted prod server (see routes/casino-dev-proxy.ts):
 *       https://api.aiexch.com/casino-platform-proxy
 *     The proxy forwards transparently to Ace using the prod server's
 *     whitelisted IP. From this client's perspective, the path shape is
 *     identical either way.
 *
 * Token caching:
 *   - The /auth/token endpoint returns `expires_in` in milliseconds
 *     (~6 hours by default). We cache in-process and refresh 5 minutes
 *     before expiry. No DB write — restarting the backend just fetches
 *     a new token on first use.
 */
import axios, { AxiosInstance } from "axios";

const BASE_URL = (
  process.env.CASINO_PLATFORM_BASE_URL || ""
).replace(/\/$/, "");

const USERNAME = process.env.CASINO_PLATFORM_USERNAME || "";
const PASSWORD = process.env.CASINO_PLATFORM_PASSWORD || "";

// If the dev proxy requires a shared secret, set CASINO_PLATFORM_PROXY_SECRET
// in local .env — the client will forward it as `X-Dev-Proxy-Secret`.
const PROXY_SECRET = process.env.CASINO_PLATFORM_PROXY_SECRET || "";

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(PROXY_SECRET ? { "X-Dev-Proxy-Secret": PROXY_SECRET } : {}),
  },
});

// ── Token cache ───────────────────────────────────────────────────────────

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;
let inflightTokenPromise: Promise<string> | null = null;

const REFRESH_LEAD_MS = 5 * 60 * 1000;

async function fetchFreshToken(): Promise<string> {
  if (!BASE_URL) {
    throw new Error(
      "[AcePlatform] CASINO_PLATFORM_BASE_URL is not set in env",
    );
  }
  if (!USERNAME || !PASSWORD) {
    throw new Error(
      "[AcePlatform] CASINO_PLATFORM_USERNAME or CASINO_PLATFORM_PASSWORD is not set",
    );
  }

  const { data } = await http.post<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>("/auth/token", { username: USERNAME, password: PASSWORD });

  if (!data?.access_token) {
    throw new Error(
      `[AcePlatform] /auth/token returned no access_token: ${JSON.stringify(data)}`,
    );
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 60_000) - REFRESH_LEAD_MS,
  };

  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  // Coalesce concurrent callers onto a single fetch.
  if (inflightTokenPromise) return inflightTokenPromise;
  inflightTokenPromise = fetchFreshToken().finally(() => {
    inflightTokenPromise = null;
  });
  return inflightTokenPromise;
}

/** Force-invalidate the cached token. Call on 401 responses. */
export function invalidateToken() {
  cachedToken = null;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  try {
    const { data } = await http.get<T>(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err: any) {
    if (err?.response?.status === 401) {
      invalidateToken();
      const retryToken = await getAccessToken();
      const { data } = await http.get<T>(path, {
        headers: { Authorization: `Bearer ${retryToken}` },
      });
      return data;
    }
    throw err;
  }
}

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  try {
    const { data } = await http.post<T>(path, body, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err: any) {
    if (err?.response?.status === 401) {
      invalidateToken();
      const retryToken = await getAccessToken();
      const { data } = await http.post<T>(path, body, {
        headers: { Authorization: `Bearer ${retryToken}` },
      });
      return data;
    }
    throw err;
  }
}

// ── Public typed methods ─────────────────────────────────────────────────

export type AceGame = {
  id: number;
  slug: string;
  name: string;
  lang: string;
  currency: string;
  thumbnail_url?: string | null;
  special_note?: string | null;
};

export async function listGames(): Promise<AceGame[]> {
  const data = await authedGet<{ games: AceGame[] }>("/games");
  return data?.games ?? [];
}

export type LaunchUrlRequest = {
  player_id: string;
  name: string;
  currency: string;
  country: string;
  lang: string;
  return_url: string;
  game_id?: number;
  player_session_token?: string;
  bet_limit?: { min: string; max: string };
};

export type LaunchUrlResponse = {
  url: string;
  player_session_token: string;
};

export async function generateLaunchUrl(
  req: LaunchUrlRequest,
): Promise<LaunchUrlResponse> {
  return authedPost<LaunchUrlResponse>("/launch-url", req);
}

// ── Diagnostics ──────────────────────────────────────────────────────────

export function clientInfo() {
  return {
    baseUrl: BASE_URL || "(unset)",
    hasUsername: Boolean(USERNAME),
    hasPassword: Boolean(PASSWORD),
    hasProxySecret: Boolean(PROXY_SECRET),
    tokenCached: Boolean(cachedToken),
    tokenExpiresAt: cachedToken?.expiresAt ?? null,
  };
}
