import { users, whitelabels } from "../db/schema";
import { eq } from "drizzle-orm";
import type { DbType } from "../types";
import { UserRole } from "../types/enums";

export const ROLES_CREATABLE_BY: Record<number, number[]> = {
  [UserRole.Owner]: [UserRole.Admin],
  [UserRole.Admin]: [UserRole.Super, UserRole.Master, UserRole.Agent, UserRole.User],
  [UserRole.Super]: [UserRole.Master, UserRole.Agent, UserRole.User],
  [UserRole.Master]: [UserRole.Agent, UserRole.User],
  [UserRole.Agent]: [UserRole.User],
};

/** Since UserRole enum values already match group_id, this is a direct pass-through. */
export function getGroupIdForRole(role: number | string): number {
  if (typeof role === "number") return role;
  // Legacy string support during transition
  const map: Record<string, number> = {
    owner: UserRole.Owner,
    admin: UserRole.Admin,
    super: UserRole.Super,
    master: UserRole.Master,
    agent: UserRole.Agent,
    user: UserRole.User,
  };
  return map[role.toLowerCase()] ?? UserRole.User;
}

export interface OwnerScopeResult {
  /** Whitelabel id the current user is allowed to see (null = no access / owner not on a whitelabel domain) */
  scopeWhitelabelId: string | null;
  /** "B2B" | "B2C" for scope whitelabel */
  whitelabelType: "B2B" | "B2C" | null;
  /** If true, filter users by addedBy = current user id (only users they created). If false, show all users of the whitelabel. */
  filterUsersByCreatedBy: boolean;
  /** Current user id (for addedBy filter) */
  currentUserId: string;
  /** Current user role (integer enum) */
  currentUserRole: number;
  /** Roles the current user is allowed to create (integer enum values) */
  allowedRolesToCreate: number[];
}

/**
 * Resolves scope for owner-panel requests:
 * - Owner: scope = whitelabel from request (domain). Can log in to any whitelabel; sees that whitelabel's data only.
 * - Admin/Super/Master/Agent: scope = their whitelabel (user.whitelabelId or whitelabel where they are userId).
 * - B2C admin: sees all users of that whitelabel.
 * - B2B admin/super/master/agent: see only users they created (addedBy = self).
 */
export async function resolveOwnerScope(
  db: DbType,
  requestWhitelabel: { id: string; whitelabelType?: string } | undefined,
  store: { id?: string; role?: number | string }
): Promise<OwnerScopeResult> {
  let currentUserId = store.id ?? "";
  let currentUserRole = typeof store.role === "number"
    ? store.role
    : (store.role != null ? getGroupIdForRole(store.role) : UserRole.User);

  // Staff delegation: if the caller is a staff user, resolve to their parent's
  // identity for data scoping. The staff inherits exactly the parent's data
  // view (whitelabel, downline, audit-by-createdBy). Permissions are still
  // gated separately by the staff's own user_staff_role + overrides.
  if (currentUserId) {
    const [u] = await db
      .select({ isStaff: users.isStaff, parentUserId: users.parentUserId })
      .from(users)
      .where(eq(users.id, currentUserId))
      .limit(1);
    if (u?.isStaff && u.parentUserId) {
      const [parent] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, u.parentUserId))
        .limit(1);
      if (parent) {
        currentUserId = parent.id;
        currentUserRole = parent.role;
      }
    }
  }

  const allowedRolesToCreate = ROLES_CREATABLE_BY[currentUserRole] ?? [];

  // Owner: use whitelabel from request (domain). Owner can open any whitelabel and see its data.
  if (currentUserRole === UserRole.Owner) {
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
  let scopeWhitelabelId: string | null = null;
  let whitelabelType: "B2B" | "B2C" | null = null;

  const [currentUser] = await db
    .select({ whitelabelId: users.whitelabelId })
    .from(users)
    .where(eq(users.id, currentUserId))
    .limit(1);
  if (currentUser?.whitelabelId != null) {
    scopeWhitelabelId = currentUser.whitelabelId;
  }
  if (scopeWhitelabelId == null) {
    const [wl] = await db
      .select({ id: whitelabels.id, whitelabelType: whitelabels.whitelabelType })
      .from(whitelabels)
      .where(eq(whitelabels.userId, currentUserId))
      .limit(1);
    if (wl) {
      scopeWhitelabelId = wl.id;
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
    whitelabelType === "B2B" && [UserRole.Admin, UserRole.Super, UserRole.Master, UserRole.Agent].includes(currentUserRole);

  return {
    scopeWhitelabelId,
    whitelabelType,
    filterUsersByCreatedBy,
    currentUserId,
    currentUserRole,
    allowedRolesToCreate,
  };
}
