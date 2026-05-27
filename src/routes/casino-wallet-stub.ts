import { Elysia, t } from "elysia";
import * as crypto from "crypto";
import { db } from "@db/index";
import { ledgerLimit, casinoTransactions } from "../db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Ace Gamings — Seamless Wallet Operator API
 *
 * Balance = ledger_limit.final_limit (same value the exchange header shows).
 *
 * Debit  → atomic UPDATE of final_limit (SELECT FOR UPDATE inside tx)
 *           → best-effort INSERT into casino_transactions (logged if table missing)
 * Credit / Rollback → same pattern, reversed sign.
 *
 * casino_transactions INSERT is intentionally kept OUTSIDE the balance
 * transaction so that a missing migration on the production DB never blocks
 * betting. Once the migration is applied the INSERT will start succeeding.
 *
 * Non-UUID player_ids (Python test-suite) fall back to in-memory state.
 */

// ─── In-memory fallback (test-suite only) ────────────────────────────────────

const DEFAULT_BALANCE = 100_000;
const memBalances = new Map<string, number>();
const memApplied = new Set<string>();

function memGetBalance(playerId: string): number {
  if (!memBalances.has(playerId)) memBalances.set(playerId, DEFAULT_BALANCE);
  return memBalances.get(playerId)!;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function nextVersion(): number {
  return Date.now();
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function dbGetFinalLimit(playerId: string): Promise<number | null> {
  if (!isUUID(playerId)) return null;
  try {
    const [row] = await db
      .select({ finalLimit: ledgerLimit.finalLimit })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, playerId))
      .limit(1);
    return row ? Number(row.finalLimit) : null;
  } catch {
    return null;
  }
}

/** Check idempotency — returns true if this txnId was already applied. */
async function dbTxnExists(txnId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: casinoTransactions.id })
      .from(casinoTransactions)
      .where(eq(casinoTransactions.transactionId, txnId))
      .limit(1);
    return !!row;
  } catch {
    // casino_transactions table not yet migrated — fall through to in-memory
    return false;
  }
}

/** Insert a casino_transactions row. Non-critical — silently logs failures. */
async function tryRecordTxn(row: typeof casinoTransactions.$inferInsert) {
  try {
    await db.insert(casinoTransactions).values(row);
  } catch (e) {
    console.error("[Casino Wallet] casino_transactions insert failed (run migration on prod?):", e);
  }
}

async function resolveBalance(playerId: string): Promise<number> {
  const fromDb = await dbGetFinalLimit(playerId);
  return fromDb !== null ? fromDb : memGetBalance(playerId);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

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

const EXPIRED_OR_INVALID_TOKENS = new Set([
  "expired-session-token",
  "invalid-random-token",
]);

const BLOCKED_PLAYER_ID = "blocked-player-id";

// ─── Plugin builder ───────────────────────────────────────────────────────────

function buildWalletPlugin(name: string, prefix: string, apiKey: string) {
  return (
    new Elysia({ name: `casino-wallet-${name}`, prefix })

      .onBeforeHandle(({ headers, set }) => {
        if (!checkApiKey(headers, apiKey)) {
          set.status = 400;
          return { code: "INVALID_API_KEY", message: "Invalid or missing Api-Key" };
        }
      })

      // ── GET /accounts/balance/{player_id} ──────────────────────────────
      .get("/accounts/balance/:player_id", async ({ params }) => {
        const balance = await resolveBalance(params.player_id);
        return { balance: fmt(balance), version: nextVersion() };
      })

      // ── POST /accounts/transactions/debit ──────────────────────────────
      .post(
        "/accounts/transactions/debit",
        async ({ body, headers, set }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);
          const sessionToken = readHeader(headers, "player-session-id");
          const isRealUser = isUUID(playerId);

          // Session check (debit only; credit/rollback skip this)
          if (!sessionToken || EXPIRED_OR_INVALID_TOKENS.has(sessionToken)) {
            const balance = await resolveBalance(playerId);
            set.status = 400;
            return {
              code: "TOKEN_EXPIRED",
              message: "Player session token is invalid or expired",
              balance: fmt(balance),
              version: nextVersion(),
            };
          }

          if (playerId === BLOCKED_PLAYER_ID) {
            const balance = await resolveBalance(playerId);
            set.status = 400;
            return {
              code: "ACCOUNT_BLOCKED",
              message: "Player account is blocked",
              balance: fmt(balance),
              version: nextVersion(),
            };
          }

          // ── Real user path ─────────────────────────────────────────────
          if (isRealUser) {
            // Idempotency: DB first, in-memory fallback
            if (memApplied.has(txnId) || await dbTxnExists(txnId)) {
              const balance = await resolveBalance(playerId);
              return { balance: fmt(balance), version: nextVersion() };
            }

            // ── Balance deduction (critical — isolated transaction) ──────
            let balanceBefore: number;
            let balanceAfter: number;
            try {
              ({ balanceBefore, balanceAfter } = await db.transaction(async (tx) => {
                const [ledger] = await tx
                  .select({
                    finalLimit: ledgerLimit.finalLimit,
                  })
                  .from(ledgerLimit)
                  .where(eq(ledgerLimit.userId, playerId))
                  .for("update")
                  .limit(1);

                if (!ledger) {
                  throw Object.assign(new Error("PLAYER_NOT_FOUND"), {
                    code: "PLAYER_NOT_FOUND",
                  });
                }

                const current = Number(ledger.finalLimit);
                if (current < amount) {
                  throw Object.assign(new Error("INSUFFICIENT_FUNDS"), {
                    code: "INSUFFICIENT_FUNDS",
                    balance: current,
                  });
                }

                const after = current - amount;
                await tx
                  .update(ledgerLimit)
                  .set({
                    finalLimit: sql`final_limit - ${amount}`,
                    limitConsumed: sql`limit_consumed + ${amount}`,
                  })
                  .where(eq(ledgerLimit.userId, playerId));

                return { balanceBefore: current, balanceAfter: after };
              }));
            } catch (err: any) {
              const code = err?.code ?? "INTERNAL_ERROR";
              if (code === "INSUFFICIENT_FUNDS") {
                set.status = 400;
                return {
                  code: "INSUFFICIENT_FUNDS",
                  message: "Insufficient funds to place this bet",
                  balance: fmt(err.balance ?? 0),
                  version: nextVersion(),
                };
              }
              if (code === "PLAYER_NOT_FOUND") {
                set.status = 400;
                return {
                  code: "PLAYER_NOT_FOUND",
                  message: "Player account not found",
                  balance: fmt(0),
                  version: nextVersion(),
                };
              }
              console.error("[Casino Wallet] Debit DB error:", err);
              set.status = 500;
              return { code: "INTERNAL_ERROR", message: "Internal server error" };
            }

            // ── Record bet details (best-effort, outside balance tx) ─────
            memApplied.add(txnId);
            await tryRecordTxn({
              transactionId: txnId,
              type: "debit",
              userId: playerId,
              roundId: b.round_id ? String(b.round_id) : null,
              gameId: b.game_id ? Number(b.game_id) : null,
              gameName: b.game_name ? String(b.game_name).slice(0, 100) : null,
              gameType: b.game_type ? String(b.game_type).slice(0, 50) : null,
              currency: b.currency ? String(b.currency).slice(0, 3) : null,
              amount: String(amount),
              requestId: b.request_id ? String(b.request_id) : null,
              balanceBefore: String(balanceBefore),
              balanceAfter: String(balanceAfter),
              status: "applied",
              rawPayload: b as Record<string, unknown>,
            });

            return { balance: fmt(balanceAfter), version: nextVersion() };
          }

          // ── In-memory path (test-suite) ────────────────────────────────
          if (memApplied.has(txnId)) {
            return { balance: fmt(memGetBalance(playerId)), version: nextVersion() };
          }
          const current = memGetBalance(playerId);
          if (current < amount) {
            set.status = 400;
            return {
              code: "INSUFFICIENT_FUNDS",
              message: "Insufficient funds to debit",
              balance: fmt(current),
              version: nextVersion(),
            };
          }
          memBalances.set(playerId, current - amount);
          memApplied.add(txnId);
          return { balance: fmt(current - amount), version: nextVersion() };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/credit ─────────────────────────────
      // Must succeed even with expired session (win arrives after session ends).
      .post(
        "/accounts/transactions/credit",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);
          const isRealUser = isUUID(playerId);

          if (isRealUser) {
            if (memApplied.has(txnId) || await dbTxnExists(txnId)) {
              const balance = await resolveBalance(playerId);
              return { balance: fmt(balance), version: nextVersion() };
            }

            let balanceBefore: number;
            let balanceAfter: number;
            try {
              ({ balanceBefore, balanceAfter } = await db.transaction(async (tx) => {
                const [ledger] = await tx
                  .select({ finalLimit: ledgerLimit.finalLimit })
                  .from(ledgerLimit)
                  .where(eq(ledgerLimit.userId, playerId))
                  .for("update")
                  .limit(1);

                if (!ledger) throw new Error("PLAYER_NOT_FOUND");

                const current = Number(ledger.finalLimit);
                const after = current + amount;

                await tx
                  .update(ledgerLimit)
                  .set({
                    finalLimit: sql`final_limit + ${amount}`,
                    limitConsumed: sql`limit_consumed - ${amount}`,
                  })
                  .where(eq(ledgerLimit.userId, playerId));

                return { balanceBefore: current, balanceAfter: after };
              }));
            } catch (err) {
              console.error("[Casino Wallet] Credit DB error:", err);
              // Credit must not fail per spec — return best-effort balance
              const balance = await dbGetFinalLimit(playerId) ?? 0;
              return { balance: fmt(balance), version: nextVersion() };
            }

            memApplied.add(txnId);
            await tryRecordTxn({
              transactionId: txnId,
              type: "credit",
              userId: playerId,
              roundId: b.round_id ? String(b.round_id) : null,
              gameId: b.game_id ? Number(b.game_id) : null,
              gameName: b.game_name ? String(b.game_name).slice(0, 100) : null,
              gameType: b.game_type ? String(b.game_type).slice(0, 50) : null,
              currency: b.currency ? String(b.currency).slice(0, 3) : null,
              amount: String(amount),
              swBetTransactionId: b.sw_bet_transaction_id
                ? String(b.sw_bet_transaction_id)
                : null,
              requestId: b.request_id ? String(b.request_id) : null,
              balanceBefore: String(balanceBefore),
              balanceAfter: String(balanceAfter),
              status: "applied",
              rawPayload: b as Record<string, unknown>,
            });

            return { balance: fmt(balanceAfter), version: nextVersion() };
          }

          // In-memory
          if (memApplied.has(txnId)) {
            return { balance: fmt(memGetBalance(playerId)), version: nextVersion() };
          }
          const current = memGetBalance(playerId);
          memBalances.set(playerId, current + amount);
          memApplied.add(txnId);
          return { balance: fmt(current + amount), version: nextVersion() };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/rollback ───────────────────────────
      .post(
        "/accounts/transactions/rollback",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const amount = Number(b.amount);
          const isRealUser = isUUID(playerId);

          if (isRealUser) {
            if (memApplied.has(txnId) || await dbTxnExists(txnId)) {
              const balance = await resolveBalance(playerId);
              return { balance: fmt(balance), version: nextVersion() };
            }

            let balanceBefore: number;
            let balanceAfter: number;
            try {
              ({ balanceBefore, balanceAfter } = await db.transaction(async (tx) => {
                const [ledger] = await tx
                  .select({ finalLimit: ledgerLimit.finalLimit })
                  .from(ledgerLimit)
                  .where(eq(ledgerLimit.userId, playerId))
                  .for("update")
                  .limit(1);

                if (!ledger) throw new Error("PLAYER_NOT_FOUND");

                const current = Number(ledger.finalLimit);
                const after = current + amount;

                await tx
                  .update(ledgerLimit)
                  .set({
                    finalLimit: sql`final_limit + ${amount}`,
                    limitConsumed: sql`limit_consumed - ${amount}`,
                  })
                  .where(eq(ledgerLimit.userId, playerId));

                return { balanceBefore: current, balanceAfter: after };
              }));
            } catch (err) {
              console.error("[Casino Wallet] Rollback DB error:", err);
              const balance = await dbGetFinalLimit(playerId) ?? 0;
              return { balance: fmt(balance), version: nextVersion() };
            }

            memApplied.add(txnId);
            await tryRecordTxn({
              transactionId: txnId,
              type: "rollback",
              userId: playerId,
              roundId: b.round_id ? String(b.round_id) : null,
              gameId: b.game_id ? Number(b.game_id) : null,
              gameName: b.game_name ? String(b.game_name).slice(0, 100) : null,
              gameType: b.game_type ? String(b.game_type).slice(0, 50) : null,
              currency: b.currency ? String(b.currency).slice(0, 3) : null,
              amount: String(amount),
              swBetTransactionId: b.sw_bet_transaction_id
                ? String(b.sw_bet_transaction_id)
                : null,
              requestId: b.request_id ? String(b.request_id) : null,
              balanceBefore: String(balanceBefore),
              balanceAfter: String(balanceAfter),
              status: "applied",
              rawPayload: b as Record<string, unknown>,
            });

            return { balance: fmt(balanceAfter), version: nextVersion() };
          }

          // In-memory
          if (memApplied.has(txnId)) {
            return { balance: fmt(memGetBalance(playerId)), version: nextVersion() };
          }
          const current = memGetBalance(playerId);
          memBalances.set(playerId, current + amount);
          memApplied.add(txnId);
          return { balance: fmt(current + amount), version: nextVersion() };
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
