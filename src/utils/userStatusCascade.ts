import { users } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import type { DbType } from "../types";

/**
 * Get all user ids that are descendants of the given user (createdBy chain).
 * E.g. if A created B and B created C, getDescendantUserIds(A) => [B, C].
 */
export async function getDescendantUserIds(
  db: DbType,
  userId: number
): Promise<number[]> {
  const result: number[] = [];
  let currentLevel: number[] = [userId];
  const seen = new Set<number>([userId]);

  while (currentLevel.length > 0) {
    const next = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.createdBy, currentLevel));
    const nextIds = next.map((r) => r.id).filter((id) => !seen.has(id));
    nextIds.forEach((id) => seen.add(id));
    result.push(...nextIds);
    currentLevel = nextIds;
  }

  return result;
}

/**
 * Compute parent_account_status and parent_bet_status for a user by walking
 * the createdBy chain (ancestors only) and AND-ing their account_status and bet_status.
 */
export async function computeParentStatuses(
  db: DbType,
  userId: number
): Promise<{ parentAccountStatus: boolean; parentBetStatus: boolean }> {
  let parentAccountStatus = true;
  let parentBetStatus = true;
  const [self] = await db
    .select({ createdBy: users.createdBy })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  let currentId: number | null = self?.createdBy ?? null;

  while (currentId != null) {
    const [row] = await db
      .select({
        createdBy: users.createdBy,
        accountStatus: users.accountStatus,
        betStatus: users.betStatus,
      })
      .from(users)
      .where(eq(users.id, currentId))
      .limit(1);
    if (!row) break;
    parentAccountStatus = parentAccountStatus && (row.accountStatus ?? true);
    parentBetStatus = parentBetStatus && (row.betStatus ?? true);
    currentId = row.createdBy;
  }

  return { parentAccountStatus, parentBetStatus };
}

/**
 * After updating a user's accountStatus or betStatus, recompute and update parent_*
 * for all descendants. We only update parent_account_status and parent_bet_status;
 * we never change a descendant's own accountStatus or betStatus.
 *
 * - On suspend: descendants' parent_* becomes false (they can't login/bet).
 * - On unsuspend: we recompute parent_* from the current ancestor chain. So
 *   descendants whose own status is true get parent_* = true again (effectively
 *   restored). Descendants who were suspended by their direct parent (own status
 *   false) keep their own status, so they stay effectively suspended. So
 *   "previous status" of each child is preserved on unsuspend.
 */
export async function cascadeParentStatuses(
  db: DbType,
  userId: number
): Promise<void> {
  const descendantIds = await getDescendantUserIds(db, userId);
  for (const id of descendantIds) {
    const { parentAccountStatus, parentBetStatus } = await computeParentStatuses(db, id);
    await db
      .update(users)
      .set({
        parentAccountStatus,
        parentBetStatus,
      })
      .where(eq(users.id, id));
  }
}
