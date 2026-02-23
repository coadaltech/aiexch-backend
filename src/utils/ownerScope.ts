import { users, whitelabels } from "../db/schema";
import { eq } from "drizzle-orm";
import type { DbType } from "../types";

export const ROLES_CREATABLE_BY: Record<string, string[]> = {
  owner: ["admin"],
  admin: ["super", "master", "agent", "user"],
  super: ["master", "agent", "user"],
  master: ["agent", "user"],
  agent: ["user"],
};

export interface OwnerScopeResult {
  /** Whitelabel id the current user is allowed to see (null = no access / owner not on a whitelabel domain) */
  scopeWhitelabelId: number | null;
  /** "B2B" | "B2C" for scope whitelabel */
  whitelabelType: "B2B" | "B2C" | null;
  /** If true, filter users by createdBy = current user id (only users they created). If false, show all users of the whitelabel. */
  filterUsersByCreatedBy: boolean;
  /** Current user id (for createdBy filter) */
  currentUserId: number;
  /** Current user role */
  currentUserRole: string;
  /** Roles the current user is allowed to create */
  allowedRolesToCreate: string[];
}

/**
 * Resolves scope for owner-panel requests:
 * - Owner: scope = whitelabel from request (domain). Can log in to any whitelabel; sees that whitelabel's data only.
 * - Admin/Super/Master/Agent: scope = their whitelabel (user.whitelabelId or whitelabel where they are userId).
 * - B2C admin: sees all users of that whitelabel.
 * - B2B admin/super/master/agent: see only users they created (createdBy = self).
 */
export async function resolveOwnerScope(
  db: DbType,
  requestWhitelabel: { id: number; whitelabelType?: string } | undefined,
  store: { id?: number; role?: string }
): Promise<OwnerScopeResult> {
  const currentUserId = Number(store.id) || 0;
  const currentUserRole = String((store.role as string) || "user").toLowerCase();
  const allowedRolesToCreate = ROLES_CREATABLE_BY[currentUserRole] ?? [];

  // Owner: use whitelabel from request (domain). Owner can open any whitelabel and see its data.
  if (currentUserRole === "owner") {
    const scopeWhitelabelId = requestWhitelabel?.id ?? null;
    const whitelabelType =
      requestWhitelabel?.whitelabelType != null
        ? (String(requestWhitelabel.whitelabelType).toUpperCase() === "B2B" ? "B2B" : "B2C")
        : null;
    return {
      scopeWhitelabelId,
      whitelabelType,
      filterUsersByCreatedBy: false,
      currentUserId,
      currentUserRole,
      allowedRolesToCreate,
    };
  }

  // Non-owner: scope = their whitelabel (whitelabelId or whitelabel where they are admin)
  let scopeWhitelabelId: number | null = null;
  let whitelabelType: "B2B" | "B2C" | null = null;

  const [currentUser] = await db
    .select({ whitelabelId: users.whitelabelId })
    .from(users)
    .where(eq(users.id, currentUserId))
    .limit(1);
  if (currentUser?.whitelabelId != null) {
    scopeWhitelabelId = Number(currentUser.whitelabelId);
  }
  if (scopeWhitelabelId == null) {
    const [wl] = await db
      .select({ id: whitelabels.id, whitelabelType: whitelabels.whitelabelType })
      .from(whitelabels)
      .where(eq(whitelabels.userId, currentUserId))
      .limit(1);
    if (wl) {
      scopeWhitelabelId = Number(wl.id);
      whitelabelType = String(wl.whitelabelType).toUpperCase() === "B2B" ? "B2B" : "B2C";
    }
  }
  if (scopeWhitelabelId != null && whitelabelType == null) {
    const [wl] = await db
      .select({ whitelabelType: whitelabels.whitelabelType })
      .from(whitelabels)
      .where(eq(whitelabels.id, scopeWhitelabelId))
      .limit(1);
    if (wl) whitelabelType = String(wl.whitelabelType).toUpperCase() === "B2B" ? "B2B" : "B2C";
  }

  // B2C: admin sees all users of whitelabel. B2B: admin/super/master/agent see only users they created.
  const filterUsersByCreatedBy =
    whitelabelType === "B2B" && ["admin", "super", "master", "agent"].includes(currentUserRole.toLowerCase());

  return {
    scopeWhitelabelId,
    whitelabelType,
    filterUsersByCreatedBy,
    currentUserId,
    currentUserRole,
    allowedRolesToCreate,
  };
}
