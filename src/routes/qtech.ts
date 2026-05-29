import { Elysia, t } from "elysia";
import crypto from "crypto";
import { db } from "@db/index";
import { users, ledgerLimit } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { parseUserAgent } from "../utils/parse-ua";
import { recordCasinoBet } from "../services/casino/casino-bet-recording";

// QTech Games "Common Wallet" endpoints.
//
// Mounted twice on the same backend so QT can hit distinct URLs for
// staging vs production while we run a single EC2:
//   /qtech/v1/*          — production, gated by QTECH_PASSKEY_PRODUCTION
//   /qtech-staging/v1/*  — staging,    gated by QTECH_PASSKEY_STAGING
//
// Auth model (per QT Common Wallet API §2.1): a shared-secret `Pass-Key`
// HTTP header — no signing, no HMAC. Constant-time compare.
//
// Endpoint shape (per §3): GET for session/balance, POST /transactions for
// both withdrawal (txnType=DEBIT) and deposit (txnType=CREDIT), separate
// /transactions/rollback. Promotion Status and Rewards live at the paths
// submitted on the QT handover form.
//
// Money + bet flow:
//   * DEBIT (bet placed): inserts one row into casino_bets +
//     casino_transaction_logs + casino_transaction_commissions and deducts
//     the stake from ledger_limit.final_limit. Idempotent on
//     (provider='qtech', provider_bet_id=txnId).
//   * CREDIT (payout) / Rollback / Rewards: acknowledged only — they return
//     the current balance so QT stops retrying, but do not modify any state.
//     Result + payout handling lands in the next phase.

const DEFAULT_CURRENCY = process.env.QT_LAUNCH_CURRENCY || "USD";

function checkPassKey(
  headers: Record<string, string | string[] | undefined>,
  passKey: string,
): boolean {
  if (!passKey) return false;
  const raw = headers["pass-key"];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent || typeof sent !== "string") return false;
  try {
    const a = Buffer.from(sent);
    const b = Buffer.from(passKey);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const loginFailed = { code: "LOGIN_FAILED", message: "The given pass-key is incorrect." };

/**
 * Look up the user + current balance for a QT `playerId`.
 * playerId is the username we sent at launch time (truncated to 34 chars).
 */
async function loadPlayer(playerId: string): Promise<{
  userId: string;
  balance: number;
  currency: string;
} | null> {
  if (!playerId) return null;
  // Username is unique. Look up case-insensitively because QT preserves the
  // exact playerId we sent at launch but a few providers normalise it.
  // Balance is `finalLimit` — the same "available to bet" number every other
  // game in this app reads (matka exposure, exchange bets, etc.). Plain
  // userBalance excludes credit-style limits and shows 0 for most users.
  const [row] = await db
    .select({
      userId: users.id,
      finalLimit: ledgerLimit.finalLimit,
    })
    .from(users)
    .leftJoin(ledgerLimit, eq(ledgerLimit.userId, users.id))
    .where(sql`lower(${users.username}) = lower(${playerId})`)
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    balance: Number(row.finalLimit ?? 0),
    currency: DEFAULT_CURRENCY,
  };
}

/** Tiny logger so QT's callback chain is visible in stdout while we debug. */
function logQt(env: string, msg: string, extra?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[qtech:${env}] ${msg}`, extra ? JSON.stringify(extra) : "");
}

interface TxnBody {
  txnType?: "DEBIT" | "CREDIT";
  txnId: string;
  betId?: string;
  playerId: string;
  roundId: string;
  amount: number | string;
  currency: string;
  gameId?: string;
  bonusType?: string;
  bonusPromoCode?: string;
}

interface RollbackBody {
  betId: string;
  txnId: string;
  playerId: string;
  roundId: string;
  amount: number | string;
  currency: string;
  gameId?: string;
}

function buildQtechPlugin(name: string, prefix: string, passKey: string) {
  return new Elysia({ name: `qtech-${name}`, prefix })
    .onBeforeHandle(({ headers, request, set }) => {
      // Log EVERY incoming hit before auth so we can tell "QT never called us"
      // from "QT called us but passkey didn't match". Never log the passkey
      // itself — just whether one was sent and whether it matched.
      const raw = headers["pass-key"];
      const sent = Array.isArray(raw) ? raw[0] : raw;
      const hasPassKey = Boolean(sent);
      const passKeyConfigured = Boolean(passKey);
      const url = new URL(request.url);
      logQt(name, "REQ", {
        method: request.method,
        path: url.pathname,
        hasPassKey,
        passKeyConfigured,
      });
      if (!checkPassKey(headers, passKey)) {
        logQt(name, "REQ rejected — passkey mismatch", {
          path: url.pathname,
          hasPassKey,
          passKeyConfigured,
        });
        set.status = 401;
        return loginFailed;
      }
    })

    // §3.1 Verify Session — GET /accounts/{playerId}/session?gameId=…
    .get("/accounts/:playerId/session", async ({ params, query, headers, set }) => {
      logQt(name, "verify-session ←", {
        playerId: params.playerId,
        gameId: query?.gameId,
        walletSession: headers["wallet-session"],
      });
      const player = await loadPlayer(params.playerId);
      if (!player) {
        logQt(name, "verify-session player NOT FOUND", { playerId: params.playerId });
        set.status = 400;
        return { code: "INVALID_TOKEN", message: "Player not found." };
      }
      const resp = { balance: player.balance, currency: player.currency };
      logQt(name, "verify-session →", resp);
      return resp;
    })

    // §3.2 Get Balance — GET /accounts/{playerId}/balance?gameId=…
    .get("/accounts/:playerId/balance", async ({ params, query, headers, set }) => {
      logQt(name, "get-balance ←", {
        playerId: params.playerId,
        gameId: query?.gameId,
        walletSession: headers["wallet-session"],
      });
      const player = await loadPlayer(params.playerId);
      if (!player) {
        logQt(name, "get-balance player NOT FOUND", { playerId: params.playerId });
        set.status = 400;
        return { code: "REQUEST_DECLINED", message: "Player not found." };
      }
      const resp = { balance: player.balance, currency: player.currency };
      logQt(name, "get-balance →", resp);
      return resp;
    })

    // §3.3 Withdrawal (txnType=DEBIT) and §3.4 Deposit (txnType=CREDIT)
    // share POST /transactions; the txnType discriminates.
    //   DEBIT  → record the bet (casino_bets + logs + commissions) and
    //            deduct the stake from ledger_limit.
    //   CREDIT → acknowledge only (payout handling lands in the next phase).
    .post(
      "/transactions",
      async ({ body, set, request }) => {
        const b = body as TxnBody;
        logQt(name, "transactions ←", {
          txnType: b?.txnType,
          txnId: b?.txnId,
          playerId: b?.playerId,
          roundId: b?.roundId,
          amount: b?.amount,
          gameId: b?.gameId,
        });
        if (!b?.txnId || !b?.playerId || !b?.roundId) {
          set.status = 400;
          return { code: "REQUEST_DECLINED", message: "Missing required fields." };
        }

        const player = await loadPlayer(b.playerId);
        if (!player) {
          logQt(name, "transactions player NOT FOUND", { playerId: b.playerId });
          set.status = 400;
          return { code: "REQUEST_DECLINED", message: "Player not found." };
        }

        const isDebit = b.txnType !== "CREDIT";
        const amount = Number(b.amount ?? 0);

        // CREDIT (and any non-DEBIT): ack only.
        if (!isDebit) {
          set.status = 201;
          return { balance: player.balance, referenceId: b.txnId };
        }

        // DEBIT: record the bet + deduct stake. Idempotent via the
        // UNIQUE(provider, provider_bet_id) constraint on casino_bets.
        const ua = parseUserAgent(request.headers.get("user-agent"));
        try {
          const result = await db.transaction((tx) =>
            recordCasinoBet(tx, {
              userId: player.userId,
              provider: "qtech",
              providerBetId: b.txnId,
              providerRoundId: b.roundId,
              providerTransactionId: b.betId ?? b.txnId,
              // QT's gameId is a string like "TK-froggrog" — store as-is.
              gameId: b.gameId ?? null,
              gameName: b.gameId ?? null,
              stake: amount,
              currency: b.currency || player.currency,
              ua,
              rawPayload: b as unknown as Record<string, unknown>,
            }),
          );

          if (!result.duplicate && result.finalLimit < 0) {
            logQt(name, "transactions INSUFFICIENT_FUNDS", {
              txnId: b.txnId,
              finalLimit: result.finalLimit,
            });
            set.status = 400;
            return {
              code: "INSUFFICIENT_FUNDS",
              message: "Insufficient funds to place bet.",
            };
          }

          set.status = 201;
          return { balance: result.finalLimit, referenceId: b.txnId };
        } catch (err) {
          logQt(name, "transactions DB error", { txnId: b.txnId, err: String(err) });
          set.status = 500;
          return { code: "UNKNOWN_ERROR", message: "Internal server error" };
        }
      },
      { body: t.Any() },
    )

    // §3.5 Rollback — ACK only. Result/refund handling lands in the next
    // phase together with settlement.
    .post(
      "/transactions/rollback",
      async ({ body }) => {
        const b = body as RollbackBody;
        const player = b?.playerId ? await loadPlayer(b.playerId) : null;
        return {
          balance: player?.balance ?? 0,
          referenceId: b?.txnId ?? `rb_${Date.now()}`,
        };
      },
      { body: t.Any() },
    )

    // §3.6 Promotion Status — informative callback, returns 204 No Content
    .post(
      "/promotion/status",
      () => new Response(null, { status: 204 }),
      { body: t.Any() },
    )

    // §3.7 Rewards — ACK only. Bonus credit application is part of the
    // payout phase, not bet recording.
    .post(
      "/rewards",
      async ({ body, set }) => {
        const b = body as {
          txnId?: string;
          playerId?: string;
        };
        const player = b?.playerId ? await loadPlayer(b.playerId) : null;
        set.status = 201;
        return {
          balance: player?.balance ?? 0,
          referenceId: b?.txnId ?? `reward_${Date.now()}`,
        };
      },
      { body: t.Any() },
    );
}

export const qtechRoutes = new Elysia()
  .use(buildQtechPlugin("prod", "/qtech/v1", process.env.QTECH_PASSKEY_PRODUCTION || ""))
  .use(buildQtechPlugin("staging", "/qtech-staging/v1", process.env.QTECH_PASSKEY_STAGING || ""));
