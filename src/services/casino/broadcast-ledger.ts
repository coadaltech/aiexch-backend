/**
 * Helper that reads the user's current ledger row and broadcasts it via the
 * `ledger` WS channel. Subscribers (header.tsx) populate the react-query
 * cache directly from the payload, avoiding the HTTP refetch round-trip.
 *
 * MUST be called AFTER the surrounding DB transaction commits — otherwise the
 * SELECT will read pre-commit state.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { ledgerLimit } from "../../db/schema";
import { broadcastChange } from "../sports-broadcast";

export interface LedgerSnapshot {
  userId: string;
  userBalance: string;
  userLimit: string;
  limitConsumed: string;
  fixLimit: string;
  finalLimit: string;
}

export async function broadcastLedgerSnapshot(userId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        userId: ledgerLimit.userId,
        userBalance: ledgerLimit.userBalance,
        userLimit: ledgerLimit.userLimit,
        limitConsumed: ledgerLimit.limitConsumed,
        fixLimit: ledgerLimit.fixLimit,
        finalLimit: ledgerLimit.finalLimit,
      })
      .from(ledgerLimit)
      .where(eq(ledgerLimit.userId, userId))
      .limit(1);

    if (row) {
      broadcastChange("ledger", {
        userId,
        ledger: row as LedgerSnapshot,
      });
    } else {
      // No ledger row — still tell the client; it'll fall back to invalidate.
      broadcastChange("ledger", { userId });
    }
  } catch (err) {
    // Broadcasting must never break the surrounding flow.
    console.error("[broadcastLedgerSnapshot] failed:", err);
  }
}
