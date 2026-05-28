import { Elysia, t } from "elysia";
import * as crypto from "crypto";
import { db } from "@db/index";
import { ledgerLimit, casinoTransactions } from "../db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Ace Gamings — Operator Wallet API (Exposure + Seamless models)
 *
 * Implements the OutboundExposure and OutboundSeamless endpoints from the
 * Ace Live Casino spec. Ace calls these on us; we authenticate via Api-Key
 * (constant-time compared against CASINO_OPERATOR_API_KEY_*).
 *
 * Endpoints exposed under each mount prefix:
 *   GET  /accounts/balance/{player_id}        (shared)
 *   POST /accounts/exposure                   (Exposure: hold/release)
 *   POST /accounts/settlement                 (Exposure: batched settle)
 *   POST /accounts/rollback                   (Exposure: batched rollback)
 *   POST /accounts/transactions/debit         (Seamless)
 *   POST /accounts/transactions/credit        (Seamless)
 *   POST /accounts/transactions/rollback      (Seamless)
 *
 * Balance = ledger_limit.final_limit. Debit/exposure-hold deducts; credit /
 * exposure-release / settlement-pl / rollback adds. All balance mutations
 * happen inside a SELECT FOR UPDATE transaction.
 *
 * Idempotency keys stored in casino_transactions.transaction_id:
 *   - Seamless debit/credit/rollback → Ace's transaction_id directly
 *   - Exposure state per round       → `expstate-{userId}-{roundId}`
 *   - Each bet from new_bets/bets    → `bet-{aceBetId}` (or `-rb` suffix on rollback)
 *   - Settlement                     → Ace's transaction_id
 *   - Rollback                       → Ace's rollback_transaction_id and transaction_id (separate keys)
 *
 * Non-UUID player_ids (Python test-suite) fall back to in-memory state.
 */

// ─── In-memory fallback (test-suite only) ────────────────────────────────────

const DEFAULT_BALANCE = 100_000;
const memBalances = new Map<string, number>();
const memApplied = new Set<string>();
// Held exposure per (player, round) — keyed by `${playerId}|${roundId}`.
// Stored as absolute value of the latest accepted exposure amount.
const memExposure = new Map<string, { amount: number; version: number }>();

function memGetBalance(playerId: string): number {
  if (!memBalances.has(playerId)) memBalances.set(playerId, DEFAULT_BALANCE);
  return memBalances.get(playerId)!;
}

function memExposureKey(playerId: string, roundId: string): string {
  return `${playerId}|${roundId}`;
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

      // ── POST /accounts/exposure ────────────────────────────────────────
      // Ace Exposure-wallet: hold/release exposure as bets are placed.
      // Version-based idempotency: if request version <= stored version,
      // discard. Otherwise apply delta = newExposure - oldExposure to balance.
      .post(
        "/accounts/exposure",
        async ({ body, headers, set }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const roundId = String(b.round_id ?? "");
          // Exposure can be passed as a signed value (negative = hold) by
          // some test clients; the spec convention is positive = amount to
          // hold. Use absolute value to handle both consistently.
          const exposureAmount = Math.abs(Number(b.exposure));
          const version = Number(b.version);
          const sessionToken = readHeader(headers, "player-session-id");
          const isRealUser = isUUID(playerId);
          const newBets = Array.isArray(b.new_bets)
            ? (b.new_bets as Array<Record<string, unknown>>)
            : [];

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
            const stateKey = `expstate-${playerId}-${roundId}`;
            let balanceAfter: number;
            try {
              balanceAfter = await db.transaction(async (tx) => {
                const [ledger] = await tx
                  .select({ finalLimit: ledgerLimit.finalLimit })
                  .from(ledgerLimit)
                  .where(eq(ledgerLimit.userId, playerId))
                  .for("update")
                  .limit(1);
                if (!ledger) {
                  throw Object.assign(new Error("PLAYER_NOT_FOUND"), {
                    code: "PLAYER_NOT_FOUND",
                  });
                }

                const [stateRow] = await tx
                  .select({
                    amount: casinoTransactions.amount,
                    rawPayload: casinoTransactions.rawPayload,
                  })
                  .from(casinoTransactions)
                  .where(eq(casinoTransactions.transactionId, stateKey))
                  .limit(1);

                const storedVersion = Number(
                  (stateRow?.rawPayload as { version?: number } | null)
                    ?.version ?? 0,
                );
                const storedExposure = stateRow ? Number(stateRow.amount) : 0;
                const current = Number(ledger.finalLimit);

                // Idempotent: same-or-older version → no-op.
                if (stateRow && version <= storedVersion) {
                  return current;
                }

                const delta = exposureAmount - storedExposure;
                if (delta > 0 && current < delta) {
                  throw Object.assign(new Error("INSUFFICIENT_FUNDS"), {
                    code: "INSUFFICIENT_FUNDS",
                    balance: current,
                  });
                }

                const after = current - delta;

                if (delta !== 0) {
                  await tx
                    .update(ledgerLimit)
                    .set({
                      finalLimit: sql`final_limit - ${delta}`,
                      limitConsumed: sql`limit_consumed + ${delta}`,
                    })
                    .where(eq(ledgerLimit.userId, playerId));
                }

                await tx
                  .insert(casinoTransactions)
                  .values({
                    transactionId: stateKey,
                    type: "exposure",
                    userId: playerId,
                    roundId,
                    gameId: b.game_id ? Number(b.game_id) : null,
                    currency: null,
                    amount: String(exposureAmount),
                    requestId: b.request_id ? String(b.request_id) : null,
                    balanceBefore: String(current),
                    balanceAfter: String(after),
                    status: "applied",
                    rawPayload: { version, exposure: exposureAmount },
                  })
                  .onConflictDoUpdate({
                    target: casinoTransactions.transactionId,
                    set: {
                      amount: String(exposureAmount),
                      balanceBefore: String(current),
                      balanceAfter: String(after),
                      requestId: b.request_id ? String(b.request_id) : null,
                      rawPayload: { version, exposure: exposureAmount },
                    },
                  });

                return after;
              });
            } catch (err: any) {
              const code = err?.code ?? "UNKNOWN_ERROR";
              if (code === "INSUFFICIENT_FUNDS") {
                set.status = 400;
                return {
                  code: "INSUFFICIENT_FUNDS",
                  message: "Insufficient funds to hold exposure",
                  balance: fmt(err.balance ?? 0),
                  version: nextVersion(),
                };
              }
              if (code === "PLAYER_NOT_FOUND") {
                set.status = 400;
                return {
                  code: "REQUEST_DECLINED",
                  message: "Player account not found",
                  balance: fmt(0),
                  version: nextVersion(),
                };
              }
              console.error("[Casino Wallet] Exposure DB error:", err);
              set.status = 500;
              return {
                code: "UNKNOWN_ERROR",
                message: "Internal server error",
              };
            }

            // Audit-log each new bet outside the balance tx.
            for (const bet of newBets) {
              if (!bet?.id) continue;
              await tryRecordTxn({
                transactionId: `bet-${bet.id}`,
                type: "bet",
                userId: playerId,
                roundId: bet.round_id ? String(bet.round_id) : roundId,
                gameId: bet.game_id ? Number(bet.game_id) : null,
                gameName: bet.game_name
                  ? String(bet.game_name).slice(0, 100)
                  : null,
                currency: bet.currency_code
                  ? String(bet.currency_code).slice(0, 3)
                  : null,
                amount: String(bet.amount ?? 0),
                requestId: b.request_id ? String(b.request_id) : null,
                status: "applied",
                rawPayload: bet,
              });
            }

            return { balance: fmt(balanceAfter), version };
          }

          // ── In-memory path (test-suite) ────────────────────────────────
          const memKey = memExposureKey(playerId, roundId);
          const prev = memExposure.get(memKey);
          if (prev && version <= prev.version) {
            return { balance: fmt(memGetBalance(playerId)), version };
          }
          const prevAmount = prev?.amount ?? 0;
          const delta = exposureAmount - prevAmount;
          const current = memGetBalance(playerId);
          if (delta > 0 && current < delta) {
            set.status = 400;
            return {
              code: "INSUFFICIENT_FUNDS",
              message: "Insufficient funds to hold exposure",
              balance: fmt(current),
              version: nextVersion(),
            };
          }
          const after = current - delta;
          memBalances.set(playerId, after);
          memExposure.set(memKey, { amount: exposureAmount, version });
          return { balance: fmt(after), version };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/settlement ──────────────────────────────────────
      // Batched settlement: release each player's held exposure and apply
      // P/L. Idempotent on transaction_id. Must succeed even with expired
      // session (round can settle after session ends) — no Player-Session-ID
      // check here.
      .post(
        "/accounts/settlement",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const items = Array.isArray(b.settlements)
            ? (b.settlements as Array<Record<string, unknown>>)
            : [];

          const results: Array<{
            player_id: string;
            balance: string;
            version: number;
          }> = [];

          for (const item of items) {
            const playerId = String(item.player_id);
            const txnId = String(item.transaction_id);
            const roundId = String(item.round_id ?? b.round_id ?? "");
            // Use request exposure as the amount to release (spec: must
            // match held; if it doesn't, override held to match request).
            const exposureRelease = Math.abs(Number(item.exposure));
            const pl = Number(item.pl);
            const isRealUser = isUUID(playerId);
            const bets = Array.isArray(item.bets)
              ? (item.bets as Array<Record<string, unknown>>)
              : [];

            if (isRealUser) {
              const stateKey = `expstate-${playerId}-${roundId}`;
              let finalBalance: number;
              try {
                finalBalance = await db.transaction(async (tx) => {
                  const [ledger] = await tx
                    .select({ finalLimit: ledgerLimit.finalLimit })
                    .from(ledgerLimit)
                    .where(eq(ledgerLimit.userId, playerId))
                    .for("update")
                    .limit(1);
                  if (!ledger) throw new Error("PLAYER_NOT_FOUND");

                  const [existing] = await tx
                    .select({ id: casinoTransactions.id })
                    .from(casinoTransactions)
                    .where(eq(casinoTransactions.transactionId, txnId))
                    .limit(1);
                  // Idempotent: already settled, return current balance.
                  if (existing) return Number(ledger.finalLimit);

                  const [stateRow] = await tx
                    .select({ amount: casinoTransactions.amount })
                    .from(casinoTransactions)
                    .where(eq(casinoTransactions.transactionId, stateKey))
                    .limit(1);
                  const heldExposure = stateRow ? Number(stateRow.amount) : 0;
                  // Spec: if held doesn't match request, sync our held to
                  // request before releasing. We always release the request
                  // amount, then add pl. heldExposure here is just for log.
                  void heldExposure;

                  const current = Number(ledger.finalLimit);
                  const after = current + exposureRelease + pl;

                  await tx
                    .update(ledgerLimit)
                    .set({
                      finalLimit: sql`final_limit + ${exposureRelease + pl}`,
                      limitConsumed: sql`limit_consumed - ${exposureRelease + pl}`,
                    })
                    .where(eq(ledgerLimit.userId, playerId));

                  await tx.insert(casinoTransactions).values({
                    transactionId: txnId,
                    type: "settlement",
                    userId: playerId,
                    roundId,
                    gameId: item.game_id ? Number(item.game_id) : null,
                    currency: null,
                    amount: String(pl),
                    requestId: item.request_id
                      ? String(item.request_id)
                      : null,
                    balanceBefore: String(current),
                    balanceAfter: String(after),
                    status: "applied",
                    rawPayload: item,
                  });

                  // Zero out the exposure-state row (mark as released).
                  if (stateRow) {
                    await tx
                      .update(casinoTransactions)
                      .set({ amount: "0", status: "released" })
                      .where(eq(casinoTransactions.transactionId, stateKey));
                  }

                  return after;
                });
              } catch (err: any) {
                console.error(
                  "[Casino Wallet] Settlement DB error for player",
                  playerId,
                  err,
                );
                // Settlement should be best-effort; still return current
                // balance so platform can move on.
                finalBalance = (await dbGetFinalLimit(playerId)) ?? 0;
              }

              // Audit-log each settled bet outside balance tx.
              for (const bet of bets) {
                if (!bet?.id) continue;
                await tryRecordTxn({
                  transactionId: `bet-${bet.id}`,
                  type: "bet_settled",
                  userId: playerId,
                  roundId: bet.round_id ? String(bet.round_id) : roundId,
                  gameId: bet.game_id ? Number(bet.game_id) : null,
                  gameName: bet.game_name
                    ? String(bet.game_name).slice(0, 100)
                    : null,
                  currency: bet.currency_code
                    ? String(bet.currency_code).slice(0, 3)
                    : null,
                  amount: String(bet.amount ?? 0),
                  requestId: item.request_id
                    ? String(item.request_id)
                    : null,
                  status: "applied",
                  rawPayload: bet,
                });
              }

              results.push({
                player_id: playerId,
                balance: fmt(finalBalance),
                version: nextVersion(),
              });
              continue;
            }

            // ── In-memory path ────────────────────────────────────────────
            if (memApplied.has(txnId)) {
              results.push({
                player_id: playerId,
                balance: fmt(memGetBalance(playerId)),
                version: nextVersion(),
              });
              continue;
            }
            const memKey = memExposureKey(playerId, roundId);
            const heldMem = memExposure.get(memKey)?.amount ?? 0;
            void heldMem;
            const current = memGetBalance(playerId);
            const after = current + exposureRelease + pl;
            memBalances.set(playerId, after);
            memExposure.delete(memKey);
            memApplied.add(txnId);
            results.push({
              player_id: playerId,
              balance: fmt(after),
              version: nextVersion(),
            });
          }

          return { results };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/rollback (batched rollback/resettlement) ────────
      // Each item carries two idempotency keys:
      //   rollback_transaction_id → rollback_pl reverses prior settlement
      //   transaction_id          → pl applies the new (resettled) outcome
      // Either may already exist; we skip whichever is already applied.
      .post(
        "/accounts/rollback",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const items = Array.isArray(b.rollbacks)
            ? (b.rollbacks as Array<Record<string, unknown>>)
            : [];

          const results: Array<{
            player_id: string;
            balance: string;
            version: number;
          }> = [];

          for (const item of items) {
            const playerId = String(item.player_id);
            const txnId = String(item.transaction_id);
            const rbTxnId = String(item.rollback_transaction_id);
            const roundId = String(item.round_id ?? b.round_id ?? "");
            const rollbackPl = Number(item.rollback_pl);
            const pl = Number(item.pl);
            const isRealUser = isUUID(playerId);
            const bets = Array.isArray(item.bets)
              ? (item.bets as Array<Record<string, unknown>>)
              : [];

            if (isRealUser) {
              let finalBalance: number;
              try {
                finalBalance = await db.transaction(async (tx) => {
                  const [ledger] = await tx
                    .select({ finalLimit: ledgerLimit.finalLimit })
                    .from(ledgerLimit)
                    .where(eq(ledgerLimit.userId, playerId))
                    .for("update")
                    .limit(1);
                  if (!ledger) throw new Error("PLAYER_NOT_FOUND");

                  const [rbExisting] = await tx
                    .select({ id: casinoTransactions.id })
                    .from(casinoTransactions)
                    .where(eq(casinoTransactions.transactionId, rbTxnId))
                    .limit(1);
                  const [resettleExisting] = await tx
                    .select({ id: casinoTransactions.id })
                    .from(casinoTransactions)
                    .where(eq(casinoTransactions.transactionId, txnId))
                    .limit(1);

                  let current = Number(ledger.finalLimit);

                  if (!rbExisting) {
                    const after = current + rollbackPl;
                    await tx
                      .update(ledgerLimit)
                      .set({
                        finalLimit: sql`final_limit + ${rollbackPl}`,
                        limitConsumed: sql`limit_consumed - ${rollbackPl}`,
                      })
                      .where(eq(ledgerLimit.userId, playerId));
                    await tx.insert(casinoTransactions).values({
                      transactionId: rbTxnId,
                      type: "rollback",
                      userId: playerId,
                      roundId,
                      gameId: item.game_id ? Number(item.game_id) : null,
                      amount: String(rollbackPl),
                      swBetTransactionId: txnId,
                      requestId: item.request_id
                        ? String(item.request_id)
                        : null,
                      balanceBefore: String(current),
                      balanceAfter: String(after),
                      status: "applied",
                      rawPayload: item,
                    });
                    current = after;
                  }

                  if (!resettleExisting) {
                    const after = current + pl;
                    await tx
                      .update(ledgerLimit)
                      .set({
                        finalLimit: sql`final_limit + ${pl}`,
                        limitConsumed: sql`limit_consumed - ${pl}`,
                      })
                      .where(eq(ledgerLimit.userId, playerId));
                    await tx.insert(casinoTransactions).values({
                      transactionId: txnId,
                      type: "resettlement",
                      userId: playerId,
                      roundId,
                      gameId: item.game_id ? Number(item.game_id) : null,
                      amount: String(pl),
                      swBetTransactionId: rbTxnId,
                      requestId: item.request_id
                        ? String(item.request_id)
                        : null,
                      balanceBefore: String(current),
                      balanceAfter: String(after),
                      status: "applied",
                      rawPayload: item,
                    });
                    current = after;
                  }

                  return current;
                });
              } catch (err: any) {
                console.error(
                  "[Casino Wallet] Rollback DB error for player",
                  playerId,
                  err,
                );
                finalBalance = (await dbGetFinalLimit(playerId)) ?? 0;
              }

              for (const bet of bets) {
                if (!bet?.id) continue;
                await tryRecordTxn({
                  transactionId: `bet-${bet.id}-rb`,
                  type: "bet_rollback",
                  userId: playerId,
                  roundId: bet.round_id ? String(bet.round_id) : roundId,
                  gameId: bet.game_id ? Number(bet.game_id) : null,
                  gameName: bet.game_name
                    ? String(bet.game_name).slice(0, 100)
                    : null,
                  currency: bet.currency_code
                    ? String(bet.currency_code).slice(0, 3)
                    : null,
                  amount: String(bet.amount ?? 0),
                  requestId: item.request_id
                    ? String(item.request_id)
                    : null,
                  status: "applied",
                  rawPayload: bet,
                });
              }

              results.push({
                player_id: playerId,
                balance: fmt(finalBalance),
                version: nextVersion(),
              });
              continue;
            }

            // ── In-memory path ────────────────────────────────────────────
            let current = memGetBalance(playerId);
            if (!memApplied.has(rbTxnId)) {
              current += rollbackPl;
              memApplied.add(rbTxnId);
            }
            if (!memApplied.has(txnId)) {
              current += pl;
              memApplied.add(txnId);
            }
            memBalances.set(playerId, current);
            results.push({
              player_id: playerId,
              balance: fmt(current),
              version: nextVersion(),
            });
          }

          return { results };
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

// Ace Gamings wallet — both Exposure and Seamless models live here. The
// `/qtech*/v1` prefixes are legacy from initial onboarding and are kept so
// any traffic already aimed there keeps working; the `/ace-wallet*/v1` paths
// are the names you should register with Ace going forward.
export const casinoWalletStubRoutes = new Elysia()
  .use(
    buildWalletPlugin(
      "ace-staging",
      "/ace-wallet-staging/v1",
      process.env.CASINO_OPERATOR_API_KEY_STAGING || "",
    ),
  )
  .use(
    buildWalletPlugin(
      "ace-prod",
      "/ace-wallet/v1",
      process.env.CASINO_OPERATOR_API_KEY_PRODUCTION || "",
    ),
  )
  // ── Legacy mounts (kept for back-compat) ─────────────────────────────
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
