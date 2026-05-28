import { Elysia, t } from "elysia";
import crypto from "crypto";
import { db } from "@db/index";
import { users, ledgerLimit, casinoTransactions } from "@db/schema";
import { eq } from "drizzle-orm";

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
// Money flow today (intentional, in-progress):
//   * Verify Session + Get Balance reflect the user's real wallet
//     (ledger_limit.user_balance).
//   * Withdrawal / Deposit / Rollback RECORD the transaction in
//     `casino_transactions` (idempotent on transactionId) but DO NOT yet
//     move money. Balance returned to QT is the current wallet balance.
//     Actual debit/credit is the next step.

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
  // Username is unique. If we ever truncate at 34 chars there could be
  // collisions on very long usernames — accepted for now since usernames
  // here are short.
  const [row] = await db
    .select({
      userId: users.id,
      userBalance: ledgerLimit.userBalance,
    })
    .from(users)
    .leftJoin(ledgerLimit, eq(ledgerLimit.userId, users.id))
    .where(eq(users.username, playerId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    balance: Number(row.userBalance ?? 0),
    currency: DEFAULT_CURRENCY,
  };
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
    .onBeforeHandle(({ headers, set }) => {
      if (!checkPassKey(headers, passKey)) {
        set.status = 401;
        return loginFailed;
      }
    })

    // §3.1 Verify Session — GET /accounts/{playerId}/session?gameId=…
    .get("/accounts/:playerId/session", async ({ params, set }) => {
      const player = await loadPlayer(params.playerId);
      if (!player) {
        set.status = 400;
        return { code: "INVALID_TOKEN", message: "Player not found." };
      }
      return { balance: player.balance, currency: player.currency };
    })

    // §3.2 Get Balance — GET /accounts/{playerId}/balance?gameId=…
    .get("/accounts/:playerId/balance", async ({ params, set }) => {
      const player = await loadPlayer(params.playerId);
      if (!player) {
        set.status = 400;
        return { code: "REQUEST_DECLINED", message: "Player not found." };
      }
      return { balance: player.balance, currency: player.currency };
    })

    // §3.3 Withdrawal (txnType=DEBIT) and §3.4 Deposit (txnType=CREDIT)
    // share POST /transactions; the txnType discriminates.
    .post(
      "/transactions",
      async ({ body, set }) => {
        const b = body as TxnBody;
        if (!b?.txnId || !b?.playerId || !b?.roundId) {
          set.status = 400;
          return { code: "REQUEST_DECLINED", message: "Missing required fields." };
        }

        const player = await loadPlayer(b.playerId);
        if (!player) {
          set.status = 400;
          return { code: "REQUEST_DECLINED", message: "Player not found." };
        }

        const type = b.txnType === "CREDIT" ? "credit" : "debit";
        const amount = Number(b.amount ?? 0);

        // Idempotency: txnId is unique. If we've already recorded this
        // transaction, just return the original balance unchanged.
        const [existing] = await db
          .select({ id: casinoTransactions.id })
          .from(casinoTransactions)
          .where(eq(casinoTransactions.transactionId, b.txnId))
          .limit(1);

        if (!existing) {
          await db.insert(casinoTransactions).values({
            transactionId: b.txnId,
            type,
            userId: player.userId,
            roundId: b.roundId,
            // QT game id is a string (e.g. "TK-froggrog"); the legacy
            // integer game_id column stays NULL — we keep the QT id in
            // game_name + raw_payload.
            gameName: (b.gameId ?? "").slice(0, 100) || null,
            currency: (b.currency || player.currency).slice(0, 3),
            amount: String(amount),
            swBetTransactionId: b.betId ?? null,
            balanceBefore: String(player.balance),
            // Wallet move not applied yet — balanceAfter mirrors before
            // so the audit row stays consistent once we wire the actual
            // debit/credit.
            balanceAfter: String(player.balance),
            status: "applied",
            rawPayload: b as unknown as object,
          });
        }

        // Wallet not moved yet — return current balance per spec shape.
        set.status = 201;
        return {
          balance: player.balance,
          referenceId: b.txnId,
        };
      },
      { body: t.Any() },
    )

    // §3.5 Rollback — POST /transactions/rollback
    .post(
      "/transactions/rollback",
      async ({ body, set }) => {
        const b = body as RollbackBody;
        const player = b?.playerId ? await loadPlayer(b.playerId) : null;

        // Per spec, an unknown original bet must be treated as a successful
        // rollback (idempotent "nothing to undo"). We still record the
        // rollback row for audit.
        if (b?.txnId && player) {
          const [existing] = await db
            .select({ id: casinoTransactions.id })
            .from(casinoTransactions)
            .where(eq(casinoTransactions.transactionId, b.txnId))
            .limit(1);
          if (!existing) {
            await db.insert(casinoTransactions).values({
              transactionId: b.txnId,
              type: "rollback",
              userId: player.userId,
              roundId: b.roundId ?? null,
              gameName: (b.gameId ?? "").slice(0, 100) || null,
              currency: (b.currency || player.currency).slice(0, 3),
              amount: String(Number(b.amount ?? 0)),
              swBetTransactionId: b.betId ?? null,
              balanceBefore: String(player.balance),
              balanceAfter: String(player.balance),
              status: "applied",
              rawPayload: b as unknown as object,
            });
          }
        }

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

    // §3.7 Rewards — POST /rewards. Treated like a CREDIT row for audit;
    // no wallet movement yet.
    .post(
      "/rewards",
      async ({ body, set }) => {
        const b = body as {
          txnId?: string;
          playerId?: string;
          amount?: number | string;
          currency?: string;
          rewardType?: string;
          rewardTitle?: string;
        };
        const player = b?.playerId ? await loadPlayer(b.playerId) : null;
        if (b?.txnId && player) {
          const [existing] = await db
            .select({ id: casinoTransactions.id })
            .from(casinoTransactions)
            .where(eq(casinoTransactions.transactionId, b.txnId))
            .limit(1);
          if (!existing) {
            await db.insert(casinoTransactions).values({
              transactionId: b.txnId,
              type: "credit",
              userId: player.userId,
              gameName: (b.rewardTitle ?? "").slice(0, 100) || null,
              currency: (b.currency || player.currency).slice(0, 3),
              amount: String(Number(b.amount ?? 0)),
              balanceBefore: String(player.balance),
              balanceAfter: String(player.balance),
              status: "applied",
              rawPayload: b as unknown as object,
            });
          }
        }
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
