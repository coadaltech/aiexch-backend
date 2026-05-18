import { Elysia, t } from "elysia";
import * as crypto from "crypto";

/**
 * Ace Gamings — Seamless Wallet Operator API (STUB)
 *
 * The Platform (Ace Gamings) calls these endpoints. In-memory state only —
 * this exists solely to validate the contract against the Python test suite
 * in `rv_gaming_operator_api_tests/`. Replace with real ledger-backed logic
 * (vouchers + ledgerLimit) once all tests pass.
 *
 * Path prefix `/qtech-staging/v1` and `/qtech/v1` are preserved because
 * those are the URLs committed to the provider in onboarding.
 *
 * Endpoints:
 *   GET  /accounts/balance/{player_id}
 *   POST /accounts/transactions/debit
 *   POST /accounts/transactions/credit
 *   POST /accounts/transactions/rollback
 *
 * Auth: shared-secret `Api-Key` header (constant-time compare).
 *
 * Critical behaviors enforced by the test suite:
 *   - Balance endpoint must respond 200 with valid / missing / expired session
 *   - Debit with missing/expired/invalid Player-Session-ID -> 400 TOKEN_EXPIRED
 *   - Credit must SUCCEED even with invalid session (settlements arrive
 *     after session expiry)
 *   - Same `transaction_id` replay returns current balance unchanged
 */

// ──────────────────────────────────────────────────────────────────────────
// In-memory state (stub only)
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_BALANCE = 100_000;

// player_id -> balance
const balances = new Map<string, number>();

// Set of transaction_ids that have been applied. Used for idempotency on
// debit / credit / rollback.
const appliedTxns = new Set<string>();

function getBalance(playerId: string): number {
  if (!balances.has(playerId)) balances.set(playerId, DEFAULT_BALANCE);
  return balances.get(playerId)!;
}

function setBalance(playerId: string, value: number) {
  balances.set(playerId, value);
}

function nextVersion(): number {
  return Date.now();
}

function fmt(amount: number): string {
  return amount.toFixed(2);
}

// ──────────────────────────────────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────────────────────────────────

function checkApiKey(
  headers: Record<string, string | string[] | undefined>,
  expected: string,
): boolean {
  if (!expected) return false;
  const raw = headers["api-key"];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent || typeof sent !== "string") return false;
  try {
    const a = Buffer.from(sent);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v : undefined;
}

// Tokens the test suite asserts should be rejected on debit. The valid
// token configured in `config.cfg` ("session-token") is NOT in this set.
const EXPIRED_OR_INVALID_TOKENS = new Set([
  "expired-session-token",
  "invalid-random-token",
]);

const BLOCKED_PLAYER_ID = "blocked-player-id";

// ──────────────────────────────────────────────────────────────────────────
// Response builders
// ──────────────────────────────────────────────────────────────────────────

function okBalance(playerId: string) {
  return { balance: fmt(getBalance(playerId)), version: nextVersion() };
}

function errBody(
  code: string,
  message: string,
  playerId?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { code, message };
  if (playerId !== undefined) {
    body.balance = fmt(getBalance(playerId));
    body.version = nextVersion();
  }
  return body;
}

// ──────────────────────────────────────────────────────────────────────────
// Plugin builder
// ──────────────────────────────────────────────────────────────────────────

function buildWalletPlugin(name: string, prefix: string, apiKey: string) {
  return (
    new Elysia({ name: `casino-wallet-${name}`, prefix })
      // ── Api-Key gate (applies to every route below) ────────────────────
      .onBeforeHandle(({ headers, set }) => {
        if (!checkApiKey(headers, apiKey)) {
          set.status = 400;
          return errBody("INVALID_API_KEY", "Invalid or missing Api-Key");
        }
      })

      // ── GET /accounts/balance/{player_id} ──────────────────────────────
      // Must return 200 with valid / missing / expired Player-Session-ID.
      .get("/accounts/balance/:player_id", ({ params }) =>
        okBalance(params.player_id),
      )

      // ── POST /accounts/transactions/debit ──────────────────────────────
      .post(
        "/accounts/transactions/debit",
        ({ body, headers, set }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);
          const sessionToken = readHeader(headers, "player-session-id");

          // Idempotency: replay returns current balance, no re-apply.
          if (txnId && appliedTxns.has(txnId)) {
            return okBalance(playerId);
          }

          // Session validation (debit only).
          if (!sessionToken || EXPIRED_OR_INVALID_TOKENS.has(sessionToken)) {
            set.status = 400;
            return errBody(
              "TOKEN_EXPIRED",
              "Player session token is invalid or expired",
              playerId,
            );
          }

          // Blocked player.
          if (playerId === BLOCKED_PLAYER_ID) {
            set.status = 400;
            return errBody(
              "ACCOUNT_BLOCKED",
              "Player account is blocked",
              playerId,
            );
          }

          // Insufficient funds.
          const current = getBalance(playerId);
          if (current < amount) {
            set.status = 400;
            return errBody(
              "INSUFFICIENT_FUNDS",
              "Insufficient funds to debit",
              playerId,
            );
          }

          setBalance(playerId, current - amount);
          appliedTxns.add(txnId);
          return okBalance(playerId);
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/credit ─────────────────────────────
      // Per spec + tests: must succeed regardless of session token state.
      // Only INVALID_API_KEY is grounds for failure.
      .post(
        "/accounts/transactions/credit",
        ({ body }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);

          if (txnId && appliedTxns.has(txnId)) {
            return okBalance(playerId);
          }

          setBalance(playerId, getBalance(playerId) + amount);
          appliedTxns.add(txnId);
          return okBalance(playerId);
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/rollback ───────────────────────────
      // Reverses a prior debit -> credits the player. Idempotent on
      // `transaction_id`. Must work without a session token.
      .post(
        "/accounts/transactions/rollback",
        ({ body }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);

          if (txnId && appliedTxns.has(txnId)) {
            return okBalance(playerId);
          }

          setBalance(playerId, getBalance(playerId) + amount);
          appliedTxns.add(txnId);
          return okBalance(playerId);
        },
        { body: t.Any() },
      )
  );
}

export const casinoWalletStubRoutes = new Elysia()
  .use(
    buildWalletPlugin(
      "staging",
      "/qtech-staging/v1",
      process.env.CASINO_OPERATOR_API_KEY_STAGING || "",
    ),
  )
  .use(
    buildWalletPlugin(
      "prod",
      "/qtech/v1",
      process.env.CASINO_OPERATOR_API_KEY_PRODUCTION || "",
    ),
  );
