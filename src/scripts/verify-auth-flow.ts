/**
 * End-to-end verification of the DPoP + rotation + reuse-detection auth flow.
 * Mimics the browser: generates an EC P-256 key, logs in with the public JWK,
 * and signs a DPoP proof per request — then asserts every guarantee against a
 * LIVE server.
 *
 * Prereqs: the step-2 migration applied, backend running, Redis up.
 *
 * Run:
 *   API_URL=http://localhost:3001 \
 *   WL_DOMAIN=aiexch.com \
 *   TEST_USER=someuser TEST_PASS=secret \
 *   AUTHED_PATH=/profile/balance \
 *   bun run src/scripts/verify-auth-flow.ts
 */
import crypto from "node:crypto";

const API_URL = process.env.API_URL || "http://localhost:3001";
const WL_DOMAIN = process.env.WL_DOMAIN || "aiexch.com";
const TEST_USER = process.env.TEST_USER || "testuser";
const TEST_PASS = process.env.TEST_PASS || "12345678";
const AUTHED_PATH = process.env.AUTHED_PATH || "/profile/balance";

if (!TEST_USER || !TEST_PASS) {
  console.error("Set TEST_USER and TEST_PASS (and WL_DOMAIN for non-owner accounts).");
  process.exit(2);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// One browser key pair for the whole session.
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pj = publicKey.export({ format: "jwk" }) as any;
const publicJwk = { kty: pj.kty, crv: pj.crv, x: pj.x, y: pj.y };

// A SECOND, unrelated key — used to simulate a thief who has the token but not
// the private key.
const attacker = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const apj = attacker.publicKey.export({ format: "jwk" }) as any;

function proof(method: string, path: string, key = privateKey, jwk = publicJwk) {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk };
  const payload = {
    htm: method.toUpperCase(),
    htu: `${API_URL}${path}`,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  };
  const si = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign("sha256", Buffer.from(si), { key, dsaEncoding: "ieee-p1363" });
  return `${si}.${b64url(sig)}`;
}

const baseHeaders = () => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WL_DOMAIN) h["x-whitelabel-domain"] = WL_DOMAIN;
  return h;
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, detail ? `— ${detail}` : ""); }
};

async function main() {
  // 1. Login WITH the DPoP public key → tokens should come back bound.
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ username: TEST_USER, password: TEST_PASS, dpopPublicKey: publicJwk }),
  });
  const login = await loginRes.json();
  check("login succeeds", loginRes.status === 200 && login.success, `status ${loginRes.status}`);
  if (loginRes.status !== 200 || !login.accessToken) {
    // Surface the server's reason and bail — the rest of the flow can't run.
    console.error(
      `\nLogin failed (HTTP ${loginRes.status}): ${login.message || JSON.stringify(login)}\n` +
        `Check that TEST_USER/TEST_PASS are valid and that WL_DOMAIN="${WL_DOMAIN}" is a ` +
        `registered whitelabel this user belongs to (or use an Owner account).`,
    );
    process.exit(1);
  }
  let access: string = login.accessToken;
  let refresh: string = login.refreshToken;
  const firstRefresh = refresh; // keep the original to replay later

  // Sanity: the access token must carry the cnf binding.
  const cnf = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).cnf;
  check("access token is key-bound (cnf.jkt present)", !!cnf?.jkt);

  // 2. Authed request WITH a valid proof → 200.
  const okRes = await fetch(`${API_URL}${AUTHED_PATH}`, {
    headers: { ...baseHeaders(), Authorization: `Bearer ${access}`, DPoP: proof("GET", AUTHED_PATH) },
  });
  check("authed request with valid proof → 200", okRes.status === 200, `status ${okRes.status}`);

  // 3. Same token but NO proof → 401 (a stolen token alone is useless).
  const noProof = await fetch(`${API_URL}${AUTHED_PATH}`, {
    headers: { ...baseHeaders(), Authorization: `Bearer ${access}` },
  });
  check("stolen token, no proof → 401", noProof.status === 401, `status ${noProof.status}`);

  // 4. Token + proof signed by a DIFFERENT key (the thief's) → 401.
  const wrongKey = await fetch(`${API_URL}${AUTHED_PATH}`, {
    headers: {
      ...baseHeaders(),
      Authorization: `Bearer ${access}`,
      DPoP: proof("GET", AUTHED_PATH, attacker.privateKey, { kty: apj.kty, crv: apj.crv, x: apj.x, y: apj.y }),
    },
  });
  check("token + wrong-key proof → 401 (core theft defense)", wrongKey.status === 401, `status ${wrongKey.status}`);

  // 5. Refresh WITH a proof → 200 + new tokens (rotation).
  const r1 = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { ...baseHeaders(), DPoP: proof("POST", "/auth/refresh") },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  const r1b = await r1.json();
  check("refresh with proof → 200 + rotated token", r1.status === 200 && r1b.refreshToken && r1b.refreshToken !== refresh, `status ${r1.status}`);
  refresh = r1b.refreshToken;
  access = r1b.accessToken;

  // 6. Refresh again → rotate once more so the ORIGINAL is now two hops stale.
  const r2 = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { ...baseHeaders(), DPoP: proof("POST", "/auth/refresh") },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  const r2b = await r2.json();
  check("second refresh → 200", r2.status === 200 && !!r2b.refreshToken, `status ${r2.status}`);
  const liveRefresh = r2b.refreshToken;

  // 7. Replay the ORIGINAL (spent) refresh token → reuse detected → 401 revoke.
  const replay = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { ...baseHeaders(), DPoP: proof("POST", "/auth/refresh") },
    body: JSON.stringify({ refreshToken: firstRefresh }),
  });
  check("replay of spent refresh token → 401 (reuse detection)", replay.status === 401, `status ${replay.status}`);

  // 8. After reuse-revoke, even the previously-live refresh token is dead.
  const afterRevoke = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { ...baseHeaders(), DPoP: proof("POST", "/auth/refresh") },
    body: JSON.stringify({ refreshToken: liveRefresh }),
  });
  check("session fully revoked after detected reuse → 401", afterRevoke.status === 401, `status ${afterRevoke.status}`);

  console.log(`\nAuth-flow E2E: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E run error:", e);
  process.exit(1);
});
