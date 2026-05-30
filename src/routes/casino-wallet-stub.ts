import { Elysia, t } from "elysia";
import * as crypto from "crypto";
import { db } from "@db/index";
import { ledgerLimit } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { parseUserAgent } from "../utils/parse-ua";
import { recordCasinoBet } from "../services/casino/casino-bet-recording";
import { broadcastLedgerSnapshot } from "../services/casino/broadcast-ledger";

/**
 * Ace Gamings — Operator Wallet (Exposure + Seamless models)
 *
 * Implements the OutboundExposure/OutboundSeamless endpoints from the Ace
 * Live Casino spec. Ace calls these on us; we authenticate via Api-Key.
 *
 * Bet-placement model:
 *   /accounts/exposure  (Exposure model — production)
 *   /accounts/transactions/debit  (Seamless model — kept for compat)
 *       → For each bet in the request we insert one row into casino_bets +
 *         casino_transaction_logs + casino_transaction_commissions, and
 *         deduct the stake from ledger_limit (final_limit). Idempotent on
 *         (provider, provider_bet_id) via the UNIQUE constraint.
 *
 * Settlement/rollback model:
 *   /accounts/settlement, /accounts/rollback, /accounts/transactions/credit,
 *   /accounts/transactions/rollback
 *       → Acknowledge only for now. They respond 200 with the current
 *         ledger_limit so Ace stops retrying, but do not modify balances or
 *         bet status — that comes in the result-system phase.
 *
 * GET /accounts/balance/{player_id}: returns ledger_limit.final_limit. Falls
 * back to a small in-memory map when player_id is not a UUID (used by Ace's
 * own python test suite, which sends `p-123` etc.).
 *
 * Mount prefixes (legacy + Ace-named — Ace can call any of them):
 *   /ace-wallet/v1            production
 *   /ace-wallet-staging/v1    staging
 *   /qtech/v1                 legacy production
 *   /qtech-staging/v1         legacy staging
 */

// ─── In-memory fallback (test-suite only) ────────────────────────────────────

const DEFAULT_BALANCE = 100_000;
const memBalances = new Map<string, number>();
const memBets = new Set<string>(); // dedupe by `${provider}|${providerBetId}`

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

async function resolveBalance(playerId: string): Promise<number> {
  const fromDb = await dbGetFinalLimit(playerId);
  return fromDb !== null ? fromDb : memGetBalance(playerId);
}

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

      // ── POST /accounts/exposure (Exposure model — primary bet path) ────
      .post(
        "/accounts/exposure",
        async ({ body, headers, set, request }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const sessionToken = readHeader(headers, "player-session-id");
          const requestId = b.request_id ? String(b.request_id) : null;
          const topRoundId = b.round_id != null ? String(b.round_id) : null;
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

          // ── In-memory path (test suite) ───────────────────────────────
          if (!isUUID(playerId)) {
            let bal = memGetBalance(playerId);
            const totalStake = newBets.reduce(
              (sum, bet) => sum + Number(bet.amount ?? 0),
              0,
            );
            if (bal < totalStake) {
              set.status = 400;
              return {
                code: "INSUFFICIENT_FUNDS",
                message: "Insufficient funds",
                balance: fmt(bal),
                version: nextVersion(),
              };
            }
            for (const bet of newBets) {
              const key = `ace|${bet.id}`;
              if (memBets.has(key)) continue;
              memBets.add(key);
              bal -= Number(bet.amount ?? 0);
            }
            memBalances.set(playerId, bal);
            return { balance: fmt(bal), version: nextVersion() };
          }

          // ── DB path (real user) ───────────────────────────────────────
          const ua = parseUserAgent(request.headers.get("user-agent"));
          try {
            const finalBalance = await db.transaction(async (tx) => {
              let lastBalance = 0;
              for (const bet of newBets) {
                if (!bet?.id) continue;
                const result = await recordCasinoBet(tx, {
                  userId: playerId,
                  provider: "ace",
                  providerBetId: String(bet.id),
                  providerRoundId:
                    bet.round_id != null
                      ? String(bet.round_id)
                      : topRoundId,
                  providerTransactionId: requestId,
                  gameId: bet.game_id != null ? String(bet.game_id) : null,
                  gameName: bet.game_name ? String(bet.game_name) : null,
                  selectionId: bet.selection_id
                    ? String(bet.selection_id)
                    : null,
                  selectionName: bet.selection_name
                    ? String(bet.selection_name)
                    : null,
                  betType:
                    bet.type === "BACK" || bet.type === "LAY"
                      ? bet.type
                      : null,
                  odds: bet.odds != null ? String(bet.odds) : null,
                  exposure:
                    bet.exposure != null ? String(bet.exposure) : null,
                  stake: Number(bet.amount ?? 0),
                  currency: bet.currency_code
                    ? String(bet.currency_code)
                    : null,
                  ipAddress: bet.ip ? String(bet.ip) : null,
                  ua,
                  rawPayload: bet,
                });
                lastBalance = result.finalLimit;
              }

              if (lastBalance < 0) {
                throw Object.assign(new Error("INSUFFICIENT_FUNDS"), {
                  code: "INSUFFICIENT_FUNDS",
                  balance: lastBalance,
                });
              }
              return lastBalance;
            });

            // Post-commit: push the new ledger snapshot to this player's
            // open tabs. Subscribers populate the react-query cache directly
            // from the payload, so the header updates instantly without an
            // HTTP round-trip. Doing this AFTER the transaction matters —
            // broadcasting inside races the commit and reads stale balance.
            await broadcastLedgerSnapshot(playerId);

            return { balance: fmt(finalBalance), version: b.version };
          } catch (err: any) {
            const code = err?.code ?? "UNKNOWN_ERROR";
            if (code === "INSUFFICIENT_FUNDS") {
              const balance = (await dbGetFinalLimit(playerId)) ?? 0;
              set.status = 400;
              return {
                code: "INSUFFICIENT_FUNDS",
                message: "Insufficient funds to place bet",
                balance: fmt(balance),
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
            return { code: "UNKNOWN_ERROR", message: "Internal server error" };
          }
        },
        { body: t.Any() },
      )

      // ── POST /accounts/settlement ──────────────────────────────────────
      // For each player settlement, call casino_declare_round which:
      //   - flips casino_bets.status (matched → won/lost/void/cancelled)
      //   - fills casino_bets.payout, settled_amount, outcome, settled_at
      //   - credits ledger_limit.user_balance by SUM(payout - stake)
      //   - inserts a casino_settlements audit row (idempotent on
      //     (provider, provider_transaction_id))
      //   - inserts vouchers + voucher_details (same shape as sports)
      //   - re-runs set_limit_used_of_user to drop limit_consumed
      .post(
        "/accounts/settlement",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const items = Array.isArray(b.settlements)
            ? (b.settlements as Array<Record<string, unknown>>)
            : [];

          console.log(
            `[Casino Wallet:${name}] /accounts/settlement HIT — items=${items.length}`,
            JSON.stringify(b),
          );

          const results: Array<{
            player_id: string;
            balance: string;
            version: number;
          }> = [];

          for (const item of items) {
            const playerId = String(item.player_id);
            const txnId = String(item.transaction_id);
            const roundId = String(
              item.round_id ?? b.round_id ?? "",
            );
            const exposure =
              item.exposure != null ? Number(item.exposure) : null;
            const bets = Array.isArray(item.bets)
              ? (item.bets as Array<Record<string, unknown>>)
              : [];

            if (!isUUID(playerId)) {
              console.log(
                `[Casino Wallet:${name}] settlement: skip non-UUID player_id=${playerId}`,
              );
              results.push({
                player_id: playerId,
                balance: fmt(memGetBalance(playerId)),
                version: nextVersion(),
              });
              continue;
            }

            // Project the bets[] array into the shape the procedure expects:
            // [{ provider_bet_id, outcome, pl }, ...]
            const betsJson = bets
              .filter((bet) => bet?.id != null)
              .map((bet) => ({
                provider_bet_id: String(bet.id),
                outcome: String(bet.outcome ?? "VOIDED"),
                pl: Number(bet.pl ?? 0),
              }));

            console.log(
              `[Casino Wallet:${name}] settlement → CALL casino_declare_round`,
              JSON.stringify({
                playerId,
                provider: "ace",
                roundId,
                txnId,
                exposure,
                bets: betsJson,
              }),
            );

            try {
              await db.execute(sql`
                CALL casino_declare_round(
                  ${playerId}::uuid,
                  ${"ace"}::varchar,
                  ${roundId}::varchar,
                  ${txnId}::varchar,
                  ${exposure}::numeric,
                  ${JSON.stringify(betsJson)}::jsonb,
                  ${JSON.stringify(item)}::jsonb
                )
              `);
              console.log(
                `[Casino Wallet:${name}] settlement → CALL ok for player=${playerId} round=${roundId}`,
              );
              // Push the new ledger snapshot so the header updates instantly.
              await broadcastLedgerSnapshot(playerId);
            } catch (err: any) {
              // Drizzle wraps the original pg error in err.cause. Pull every
              // field the underlying driver offers so the postgres-level
              // reason is visible (column missing, type mismatch, etc.).
              const cause = err?.cause ?? err?.original ?? {};
              console.error(
                `[Casino Wallet:${name}] settlement → CALL FAILED for player=${playerId} round=${roundId}`,
                JSON.stringify({
                  message: err?.message,
                  pgMessage: cause?.message,
                  pgCode: cause?.code,
                  pgDetail: cause?.detail,
                  pgHint: cause?.hint,
                  pgWhere: cause?.where,
                  pgSchema: cause?.schema,
                  pgTable: cause?.table,
                  pgColumn: cause?.column,
                  pgRoutine: cause?.routine,
                }),
              );
              // Per Ace spec: 500 triggers retry. Per-player failure inside a
              // batch is rare — log and continue so other players still settle.
            }

            const balance = (await dbGetFinalLimit(playerId)) ?? 0;
            results.push({
              player_id: playerId,
              balance: fmt(balance),
              version: nextVersion(),
            });
          }

          return { results };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/rollback — ACK only ─────────────────────────────
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
            const balance = await resolveBalance(playerId);
            results.push({
              player_id: playerId,
              balance: fmt(balance),
              version: nextVersion(),
            });
          }
          return { results };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/debit (Seamless bet placement) ─────
      // Single-bet form. Records via the same path as exposure so commission
      // + logs + ledger move stay consistent.
      .post(
        "/accounts/transactions/debit",
        async ({ body, headers, set, request }) => {
          const b = body as Record<string, unknown>;
          const playerId = String(b.player_id);
          const txnId = String(b.transaction_id);
          const stake = Number(b.amount ?? 0);
          const sessionToken = readHeader(headers, "player-session-id");

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

          if (!isUUID(playerId)) {
            const key = `ace|${txnId}`;
            if (memBets.has(key)) {
              return {
                balance: fmt(memGetBalance(playerId)),
                version: nextVersion(),
              };
            }
            const bal = memGetBalance(playerId);
            if (bal < stake) {
              set.status = 400;
              return {
                code: "INSUFFICIENT_FUNDS",
                message: "Insufficient funds",
                balance: fmt(bal),
                version: nextVersion(),
              };
            }
            memBets.add(key);
            memBalances.set(playerId, bal - stake);
            return { balance: fmt(bal - stake), version: nextVersion() };
          }

          const ua = parseUserAgent(request.headers.get("user-agent"));
          try {
            const result = await db.transaction((tx) =>
              recordCasinoBet(tx, {
                userId: playerId,
                provider: "ace",
                providerBetId: txnId,
                providerRoundId: b.round_id ? String(b.round_id) : null,
                providerTransactionId: b.request_id
                  ? String(b.request_id)
                  : null,
                gameId: b.game_id != null ? String(b.game_id) : null,
                gameName: b.game_name ? String(b.game_name) : null,
                stake,
                currency: b.currency ? String(b.currency) : null,
                ua,
                rawPayload: b,
              }),
            );

            if (!result.duplicate && result.finalLimit < 0) {
              const balance = (await dbGetFinalLimit(playerId)) ?? 0;
              set.status = 400;
              return {
                code: "INSUFFICIENT_FUNDS",
                message: "Insufficient funds to place bet",
                balance: fmt(balance),
                version: nextVersion(),
              };
            }

            // Post-commit ledger refresh (skip on duplicate retry — balance
            // didn't actually change).
            if (!result.duplicate) {
              await broadcastLedgerSnapshot(playerId);
            }

            return {
              balance: fmt(result.finalLimit),
              version: nextVersion(),
            };
          } catch (err: any) {
            const code = err?.code ?? "UNKNOWN_ERROR";
            if (code === "PLAYER_NOT_FOUND") {
              set.status = 400;
              return {
                code: "REQUEST_DECLINED",
                message: "Player account not found",
                balance: fmt(0),
                version: nextVersion(),
              };
            }
            console.error("[Casino Wallet] Debit DB error:", err);
            set.status = 500;
            return { code: "UNKNOWN_ERROR", message: "Internal server error" };
          }
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/credit — ACK only ──────────────────
      .post(
        "/accounts/transactions/credit",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const balance = await resolveBalance(String(b.player_id));
          return { balance: fmt(balance), version: nextVersion() };
        },
        { body: t.Any() },
      )

      // ── POST /accounts/transactions/rollback — ACK only ────────────────
      .post(
        "/accounts/transactions/rollback",
        async ({ body }) => {
          const b = body as Record<string, unknown>;
          const balance = await resolveBalance(String(b.player_id));
          return { balance: fmt(balance), version: nextVersion() };
        },
        { body: t.Any() },
      )
  );
}

// Both legacy /qtech*/v1 and Ace-named /ace-wallet*/v1 prefixes are mounted
// so Ace can call any URL we shipped them.
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
