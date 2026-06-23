/**
 * DPoP — Demonstrating Proof of Possession (RFC 9449).
 *
 * Sender-constrained tokens: an access/refresh token is bound to a public key
 * whose private half never leaves the user's browser (generated non-extractable
 * via Web Crypto). On every request the client signs a short-lived "proof" JWT
 * with that private key. A stolen token alone is useless — the thief cannot
 * forge a matching proof without the private key, so it can't be replayed from
 * Postman or another machine.
 *
 * This module verifies an incoming proof and returns the thumbprint (jkt) of the
 * key that signed it. The caller compares that jkt against the one bound into
 * the token (access token `cnf.jkt`, refresh token `jkt`).
 *
 * Proof shape (a compact JWS):
 *   header  = { typ: "dpop+jwt", alg: "ES256", jwk: <public EC P-256 JWK> }
 *   payload = { jti, htm, htu, iat }
 */
import crypto from "node:crypto";
import { redis, redisIsHealthy } from "@db/redis";

const MAX_AGE_SECONDS = 60; // a proof is valid for ~1 minute after it's signed
const CLOCK_SKEW_SECONDS = 10; // tolerate small client/server clock drift
const REPLAY_TTL_SECONDS = 120; // remember each jti at least as long as it's fresh

export interface DpopVerifyResult {
  ok: boolean;
  /** RFC 7638 thumbprint of the signing key — compare to the token's bound jkt. */
  jkt?: string;
  reason?: string;
}

interface EcPublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string; // private component — MUST never be present in a proof
}

/**
 * RFC 7638 JWK thumbprint for an EC public key: SHA-256 of the canonical,
 * lexicographically-ordered, whitespace-free JSON of the required members.
 */
export function jwkThumbprint(jwk: EcPublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

function decodeSegment(seg: string): any {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

/**
 * Compare the proof's `htu` to the actual request path. We compare PATHNAME only
 * (not host/query) so the check is robust behind a reverse proxy — the backend
 * may see a different internal host than the public `api.<domain>` the browser
 * signed. Binding the path still prevents a captured proof from being reused
 * against a different endpoint.
 */
function pathMatches(htu: unknown, requestPath: string): boolean {
  if (typeof htu !== "string" || !htu) return false;
  let proofPath: string;
  try {
    proofPath = new URL(htu).pathname;
  } catch {
    // htu wasn't an absolute URL; treat it as a bare path.
    proofPath = htu.split("?")[0];
  }
  return proofPath === requestPath.split("?")[0];
}

/**
 * Verify a DPoP proof for the given HTTP method + request path. Returns the
 * signing key's thumbprint on success. Never throws — returns { ok:false }.
 */
export async function verifyDpopProof(
  proof: string | undefined,
  method: string,
  requestPath: string,
): Promise<DpopVerifyResult> {
  if (!proof) return { ok: false, reason: "missing_proof" };

  const parts = proof.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  let header: any;
  let payload: any;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Header must declare a DPoP proof signed with ES256 and carry the public JWK.
  if (header.typ !== "dpop+jwt") return { ok: false, reason: "bad_typ" };
  if (header.alg !== "ES256") return { ok: false, reason: "bad_alg" };
  const jwk = header.jwk as EcPublicJwk | undefined;
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    return { ok: false, reason: "bad_jwk" };
  }
  // A proof must carry only the PUBLIC key. Reject anything with a private part.
  if (jwk.d) return { ok: false, reason: "private_key_in_proof" };

  // Verify the signature with the embedded public key.
  let keyObject: crypto.KeyObject;
  try {
    keyObject = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  } catch {
    return { ok: false, reason: "bad_key" };
  }
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  let verified = false;
  try {
    // JOSE/Web Crypto ES256 signatures are raw r||s (P-1363), not DER.
    verified = crypto.verify(
      "sha256",
      signingInput,
      { key: keyObject, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return { ok: false, reason: "bad_sig_format" };
  }
  if (!verified) return { ok: false, reason: "bad_signature" };

  // Bind the proof to this exact method + endpoint.
  if (typeof payload.htm !== "string" || payload.htm.toUpperCase() !== method.toUpperCase()) {
    return { ok: false, reason: "htm_mismatch" };
  }
  if (!pathMatches(payload.htu, requestPath)) {
    return { ok: false, reason: "htu_mismatch" };
  }

  // Freshness — reject stale or future-dated proofs.
  const iat = Number(payload.iat);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(iat)) return { ok: false, reason: "bad_iat" };
  if (iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "iat_future" };
  if (now - iat > MAX_AGE_SECONDS) return { ok: false, reason: "expired" };

  const jti = payload.jti;
  if (typeof jti !== "string" || !jti) return { ok: false, reason: "bad_jti" };

  // Replay protection: each proof jti is single-use within the freshness window.
  // If Redis is down we skip this — the short freshness window still bounds the
  // replay risk, and we never want a Redis hiccup to lock everyone out.
  if (redisIsHealthy()) {
    try {
      const set = await redis.set(`dpop:jti:${jti}`, "1", {
        NX: true,
        EX: REPLAY_TTL_SECONDS,
      });
      if (set === null) return { ok: false, reason: "replay" };
    } catch {
      /* Redis blip — fall through, bounded by freshness window. */
    }
  }

  return { ok: true, jkt: jwkThumbprint(jwk) };
}
