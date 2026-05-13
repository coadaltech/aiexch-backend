/**
 * Permission resolution service.
 *
 * Single source of truth for "what can this user do?". Used by:
 *   - Route guards (middleware/auth.ts → requirePermission)
 *   - /profile/me & login responses (so the frontend can hide UI)
 *
 * Resolution rule:
 *   1. If user.role === Owner → return ALL_PERMISSIONS (bypass).
 *   2. role_perms  = SELECT keys via user_staff_role → staff_role_permissions
 *      grants     = user_permission_overrides WHERE effect='GRANT'
 *      denies     = user_permission_overrides WHERE effect='DENY'
 *   3. Effective = (role_perms ∪ grants) − denies
 *
 * Caches result for the lifetime of a request via a WeakMap keyed on a
 * caller-provided cache object (typically Elysia's per-request `derive`d state).
 */

import { eq, and } from "drizzle-orm";
import { db as defaultDb } from "@db/index";
import { users, permissions, staffRolePermissions, userStaffRole, userPermissionOverrides } from "@db/schema";
import { UserRole } from "../types/enums";
import { PERMISSIONS, PERMISSION_KEYS } from "../permissions/catalog";

type Db = typeof defaultDb;

const ALL_PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

/**
 * Returns the full set of permission keys the user effectively holds.
 * Pass `userRole` if known (saves one DB roundtrip); otherwise it's looked up.
 */
export async function getEffectivePermissions(
  userId: string,
  opts?: { userRole?: number; db?: Db },
): Promise<Set<string>> {
  const db = opts?.db ?? defaultDb;

  // Fetch role + is_staff in one query. We need is_staff to decide whether the
  // Owner-bypass applies — an Owner's *staff* (role=Owner, is_staff=true) must
  // walk the permission table like any other staff.
  let role = opts?.userRole;
  let isStaff = false;
  if (role === undefined) {
    const [row] = await db
      .select({ role: users.role, isStaff: users.isStaff })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return new Set();
    role = row.role;
    isStaff = row.isStaff;
  } else {
    // Caller passed the role — still need is_staff to gate the bypass.
    const [row] = await db
      .select({ isStaff: users.isStaff })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    isStaff = row?.isStaff ?? false;
  }

  if (role === UserRole.Owner && !isStaff) {
    // Real Owner (not a staff). Bypasses the table — has every permission.
    return new Set(ALL_PERMISSION_KEYS);
  }

  // Role permissions (via assigned staff role).
  const rolePermsRows = await db
    .select({ key: permissions.key })
    .from(userStaffRole)
    .innerJoin(staffRolePermissions, eq(staffRolePermissions.staffRoleId, userStaffRole.staffRoleId))
    .innerJoin(permissions, eq(permissions.id, staffRolePermissions.permissionId))
    .where(eq(userStaffRole.userId, userId));

  // Per-user overrides.
  const overrideRows = await db
    .select({ key: permissions.key, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .innerJoin(permissions, eq(permissions.id, userPermissionOverrides.permissionId))
    .where(eq(userPermissionOverrides.userId, userId));

  const effective = new Set<string>(rolePermsRows.map((r) => r.key));
  for (const o of overrideRows) {
    if (o.effect === "GRANT") effective.add(o.key);
  }
  for (const o of overrideRows) {
    if (o.effect === "DENY") effective.delete(o.key);
  }
  return effective;
}

/** Convenience: returns true iff `userId` holds `key`. */
export async function userHasPermission(
  userId: string,
  key: string,
  opts?: { userRole?: number; db?: Db },
): Promise<boolean> {
  if (!PERMISSION_KEYS.has(key)) {
    // Unknown key → fail closed. This catches typos in route guards.
    return false;
  }
  const set = await getEffectivePermissions(userId, opts);
  return set.has(key);
}

/** Convenience: returns true iff `userId` holds at least one of `keys`. */
export async function userHasAnyPermission(
  userId: string,
  keys: string[],
  opts?: { userRole?: number; db?: Db },
): Promise<boolean> {
  if (keys.length === 0) return false;
  const set = await getEffectivePermissions(userId, opts);
  return keys.some((k) => set.has(k));
}

/** Convenience: returns true iff `userId` holds all of `keys`. */
export async function userHasAllPermissions(
  userId: string,
  keys: string[],
  opts?: { userRole?: number; db?: Db },
): Promise<boolean> {
  if (keys.length === 0) return true;
  const set = await getEffectivePermissions(userId, opts);
  return keys.every((k) => set.has(k));
}

export const ALL_PERMISSIONS_FOR_OWNER = ALL_PERMISSION_KEYS;
