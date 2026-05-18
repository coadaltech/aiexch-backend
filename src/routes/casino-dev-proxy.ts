import { Elysia, t } from "elysia";
import * as crypto from "crypto";

/**
 * Ace Gamings Dev Proxy
 *
 * Forwards inbound API calls to Ace using the host server's IP. Intended to
 * run on your production/staging EC2 box (the IP Ace has whitelisted) so
 * local developers can reach `/auth/token`, `/games`, `/launch-url` without
 * each developer's machine needing to be whitelisted by Ace.
 *
 * Mount path: /casino-platform-proxy/*
 *   POST /casino-platform-proxy/auth/token   -> Ace /auth/token
 *   GET  /casino-platform-proxy/games        -> Ace /games
 *   POST /casino-platform-proxy/launch-url   -> Ace /launch-url
 *
 * Auth: shared-secret `X-Dev-Proxy-Secret` header. Constant-time compared.
 *
 * Activation: set CASINO_DEV_PROXY_ENABLED=true on the prod server's env.
 * Default-off — if the env var is missing, every request returns 404 so the
 * proxy never accidentally ships to a public production box.
 *
 * Auth header passthrough: any `Authorization` header sent by the client
 * (typically `Bearer <token>` after auth) is forwarded verbatim. `Api-Key`
 * is NOT forwarded — wallet callbacks go in the *other* direction and don't
 * need this proxy.
 */

const ACE_BASE_URL = (
  process.env.CASINO_PLATFORM_REMOTE_BASE_URL ||
    "https://staging-op-api.acegamings.com/api/operator/e_w/v1"
).replace(/\/$/, "");

const PROXY_SECRET = process.env.CASINO_PLATFORM_PROXY_SECRET || "";
const PROXY_ENABLED = process.env.CASINO_DEV_PROXY_ENABLED === "true";

function checkSecret(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!PROXY_SECRET) return false;
  const raw = headers["x-dev-proxy-secret"];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent || typeof sent !== "string") return false;
  try {
    const a = Buffer.from(sent);
    const b = Buffer.from(PROXY_SECRET);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getAuthHeader(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers["authorization"];
  return Array.isArray(raw) ? raw[0] : raw;
}

async function forward(
  method: "GET" | "POST",
  upstreamPath: string,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${ACE_BASE_URL}${upstreamPath}`;
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(getAuthHeader(headers)
        ? { Authorization: getAuthHeader(headers)! }
        : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  };

  const res = await fetch(url, init);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = { error: "non-JSON upstream response" };
  }
  return { status: res.status, data: parsed };
}

export const casinoDevProxyRoutes = new Elysia({
  prefix: "/casino-platform-proxy",
})
  .onBeforeHandle(({ set }) => {
    if (!PROXY_ENABLED) {
      set.status = 404;
      return { error: "Not Found" };
    }
  })
  .onBeforeHandle(({ headers, set }) => {
    if (!checkSecret(headers)) {
      set.status = 401;
      return { error: "Invalid or missing X-Dev-Proxy-Secret" };
    }
  })
  .post(
    "/auth/token",
    async ({ body, headers, set }) => {
      const { status, data } = await forward("POST", "/auth/token", headers, body);
      set.status = status;
      return data;
    },
    { body: t.Any() },
  )
  .get("/games", async ({ headers, set }) => {
    const { status, data } = await forward("GET", "/games", headers, undefined);
    set.status = status;
    return data;
  })
  .post(
    "/launch-url",
    async ({ body, headers, set }) => {
      const { status, data } = await forward(
        "POST",
        "/launch-url",
        headers,
        body,
      );
      set.status = status;
      return data;
    },
    { body: t.Any() },
  );
