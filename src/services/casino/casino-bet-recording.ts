/**
 * Shared casino bet-recording flow used by both the Ace and QTech wallet
 * handlers. Mirrors the sports bet placement path in src/routes/betting.ts
 * so commission reports and limit accounting work identically across
 * sports and casino.
 *
 * One call to recordCasinoBet does, inside the caller's transaction:
 *   1. Snapshot the user's whitelabel + hierarchy commission shares
 *   2. INSERT casino_transactions               (one row per bet)
 *   3. INSERT casino_transaction_logs   (one row, matched by casinoBetId)
 *   4. INSERT casino_transaction_commissions (one row, matched by casinoBetId)
 *   5. UPDATE ledger_limit              (final_limit -= stake, limit_consumed += stake)
 *
 * Idempotency: relies on the casino_transactions UNIQUE(provider, provider_bet_id)
 * constraint. A duplicate insert returns null and skips the rest — caller
 * treats this as "already recorded" and returns the current balance.
 */
import { sql, eq } from "drizzle-orm";
import {
  users,
  ledgerLimit,
  casinoTransactions,
  casinoTransactionLogs,
  casinoTransactionCommissions,
} from "../../db/schema";
import { UserRole } from "../../types/enums";
import type { ParsedUA } from "../../utils/parse-ua";
import type { db as dbType } from "../../db";

// Caller passes either the top-level `db` or a transaction handle.
type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

export type CasinoProvider = "ace" | "qtech";

export interface RecordCasinoBetInput {
  userId: string;
  provider: CasinoProvider;
  providerBetId: string;
  providerRoundId?: string | null;
  providerTransactionId?: string | null;
  gameId?: string | null;
  gameName?: string | null;
  /** Ace-only — leave undefined for QTech. */
  selectionId?: string | null;
  selectionName?: string | null;
  betType?: "BACK" | "LAY" | null;
  odds?: number | string | null;
  exposure?: number | string | null;
  stake: number | string;
  currency?: string | null;
  ipAddress?: string | null;
  ua?: ParsedUA | null;
  /** Full provider bet object, stored verbatim for audit / disputes. */
  rawPayload?: Record<string, unknown> | null;
}

export interface RecordCasinoBetResult {
  /** The inserted casino_transactions row, or null if the bet was already recorded. */
  betId: string | null;
  /** ledger_limit.final_limit AFTER this bet's deduction. */
  finalLimit: number;
  duplicate: boolean;
}

/**
 * Record a casino bet inside the given Drizzle transaction.
 *
 * Caller is responsible for opening the transaction so multiple bets in a
 * single provider callback can share it (one tx per /accounts/exposure call).
 */
export async function recordCasinoBet(
  tx: Tx,
  input: RecordCasinoBetInput,
): Promise<RecordCasinoBetResult> {
  // 1. Snapshot whitelabel from the user row.
  const [user] = await tx
    .select({ whitelabelId: users.whitelabelId })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) {
    throw Object.assign(new Error("PLAYER_NOT_FOUND"), {
      code: "PLAYER_NOT_FOUND",
    });
  }

  const stakeNum = Number(input.stake);
  if (!Number.isFinite(stakeNum) || stakeNum < 0) {
    throw new Error(`Invalid stake: ${input.stake}`);
  }

  // 2. Insert casino_transactions — ON CONFLICT DO NOTHING handles retries.
  const inserted = await tx
    .insert(casinoTransactions)
    .values({
      userId: input.userId,
      whitelabelId: user.whitelabelId ?? null,
      provider: input.provider,
      providerBetId: input.providerBetId,
      providerRoundId: input.providerRoundId ?? null,
      providerTransactionId: input.providerTransactionId ?? null,
      gameId: input.gameId ?? null,
      gameName: input.gameName ? input.gameName.slice(0, 100) : null,
      selectionId: input.selectionId ?? null,
      selectionName: input.selectionName
        ? input.selectionName.slice(0, 255)
        : null,
      betType: input.betType ?? null,
      stake: String(stakeNum),
      odds: input.odds != null ? String(input.odds) : null,
      // Exposure = worst-case liability for this bet. Ace provides it per
      // bet (correctly accounting for LAY odds where liability != stake);
      // QT sends none, so we fall back to the stake (single-amount model).
      // The limit + settlement procedures both rely on this column being
      // populated — never leave it NULL.
      exposure:
        input.exposure != null
          ? String(Math.abs(Number(input.exposure)))
          : String(stakeNum),
      currency: input.currency ? input.currency.slice(0, 3) : null,
      status: "matched",
      ipAddress: input.ipAddress ?? null,
      placedAt: new Date(),
      rawPayload: (input.rawPayload as object) ?? null,
      addedBy: input.userId,
      updateBy: input.userId,
    })
    .onConflictDoNothing({
      target: [casinoTransactions.provider, casinoTransactions.providerBetId],
    })
    .returning({ id: casinoTransactions.id });

  if (inserted.length === 0) {
    // Duplicate — return current balance without re-deducting.
    const [ledger] = await tx
      .select({ finalLimit: ledgerLimit.finalLimit })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, input.userId))
      .limit(1);
    return {
      betId: null,
      finalLimit: Number(ledger?.finalLimit ?? 0),
      duplicate: true,
    };
  }

  const betId = inserted[0].id;

  // 3. casino_transaction_logs
  await tx.insert(casinoTransactionLogs).values({
    casinoBetId: betId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.ua?.userAgent || null,
    browser: input.ua?.browser ?? null,
    browserVersion: input.ua?.browserVersion ?? null,
    os: input.ua?.os ?? null,
    osVersion: input.ua?.osVersion ?? null,
    deviceType: input.ua?.deviceType ?? null,
    deviceBrand: input.ua?.deviceBrand ?? null,
    deviceModel: input.ua?.deviceModel ?? null,
    addedBy: input.userId,
    updateBy: input.userId,
  });

  // 4. Commission snapshot — same recursive walk as sports betting.ts:654.
  const hierarchyRows = await tx.execute(sql`
    WITH RECURSIVE hierarchy AS (
      SELECT
        u.id AS ancestor_id,
        u.role AS ancestor_role,
        p.downline::DECIMAL(5,2) AS downline,
        1 AS depth
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = (SELECT added_by FROM users WHERE id = ${input.userId})

      UNION ALL

      SELECT
        u2.id,
        u2.role,
        p2.downline::DECIMAL(5,2),
        h.depth + 1
      FROM hierarchy h
      JOIN users u2 ON u2.id = (SELECT added_by FROM users WHERE id = h.ancestor_id)
      JOIN profiles p2 ON p2.user_id = u2.id
      WHERE h.depth < 10
        AND u2.id IS NOT NULL
    )
    SELECT ancestor_id, ancestor_role, downline
    FROM hierarchy
    ORDER BY depth ASC
  `);

  const ancestors =
    (Array.isArray(hierarchyRows)
      ? hierarchyRows
      : (hierarchyRows as { rows?: unknown[] })?.rows) ?? [];

  const snapshot: typeof casinoTransactionCommissions.$inferInsert = {
    casinoBetId: betId,
    addedBy: input.userId,
    updateBy: input.userId,
  };

  let previousDownline = 0;
  for (const raw of ancestors as Array<{
    ancestor_id: string;
    ancestor_role: number | string;
    downline: string | null;
  }>) {
    const role = Number(raw.ancestor_role);
    const downline = parseFloat(raw.downline ?? "0");
    const share = downline - previousDownline;

    if (role === UserRole.Agent) {
      snapshot.agentId = raw.ancestor_id;
      snapshot.agentPercent = Math.max(share, 0).toFixed(2);
    } else if (role === UserRole.Master) {
      snapshot.masterId = raw.ancestor_id;
      snapshot.masterPercent = Math.max(share, 0).toFixed(2);
    } else if (role === UserRole.Super) {
      snapshot.superId = raw.ancestor_id;
      snapshot.superPercent = Math.max(share, 0).toFixed(2);
    } else if (role === UserRole.Admin) {
      snapshot.adminId = raw.ancestor_id;
      snapshot.adminPercent = Math.max(share, 0).toFixed(2);
    } else if (role === UserRole.Owner) {
      snapshot.ownerId = raw.ancestor_id;
      snapshot.ownerPercent = Math.max(100 - previousDownline, 0).toFixed(2);
    }

    previousDownline = downline;
  }

  await tx.insert(casinoTransactionCommissions).values(snapshot);

  // 5. Recalculate the user's limit via the shared stored procedure (same
  // call sports betting uses, see src/routes/betting.ts). The procedure
  // sums potential losses across sports markets, matka, and casino_transactions,
  // then writes limit_consumed and final_limit. Casino bets are picked up
  // because they're inserted above with status='matched'.
  await tx.execute(sql`CALL set_limit_used_of_user(${input.userId}::uuid)`);

  const [updated] = await tx
    .select({ finalLimit: ledgerLimit.finalLimit })
    .from(ledgerLimit)
    .where(eq(ledgerLimit.userId, input.userId))
    .limit(1);

  // NOTE: ledger-changed WS broadcast happens in the CALLER, AFTER the
  // surrounding transaction commits — otherwise subscribers race the commit
  // and refetch the pre-commit balance.

  return {
    betId,
    finalLimit: Number(updated?.finalLimit ?? 0),
    duplicate: false,
  };
}
