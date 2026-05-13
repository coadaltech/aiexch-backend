/**
 * Permission guards for Elysia routes.
 *
 * These are designed to live INSIDE the existing /owner/* gate (which already
 * verifies the JWT, role hierarchy and session token via `app_middleware`).
 * That gate populates `userId` and `userRole` on the request via `.resolve()`,
 * and these guards consume those values.
 *
 * Usage examples:
 *
 *   .post("/", handler, { beforeHandle: requirePermission("banners.create") })
 *
 *   .guard({
 *     beforeHandle: requireAnyPermission(["users.edit", "users.status_toggle"]),
 *   })
 *
 *   const guard = requirePermission("banners.delete");
 *   .delete("/:id", handler, { beforeHandle: guard })
 *
 * Owner role (role === 0) bypasses the permission table entirely — see
 * services/permissions.ts.
 */

import { userHasPermission, userHasAnyPermission, userHasAllPermissions } from "@services/permissions";
import { PERMISSION_KEYS } from "../permissions/catalog";

// `set` is typed loosely (status accepts numbers or HTTP-status-name strings in
// Elysia). Intersection with the rest of the request context — Elysia infers
// per-route shapes so a strict type here would fail to assign.
type GuardCtx = {
  userId?: string;
  userRole?: number;
  set: { status?: any };
  [key: string]: any;
};

const FORBIDDEN = (set: GuardCtx["set"], message = "You do not have permission to perform this action") => {
  set.status = 403;
  return { success: false, message };
};

const UNAUTHORIZED = (set: GuardCtx["set"]) => {
  set.status = 401;
  return { success: false, message: "Not authenticated" };
};

function assertKnownKey(key: string) {
  if (!PERMISSION_KEYS.has(key)) {
    // Throw at boot/registration time so typos surface immediately rather than
    // silently turning into 403s for end users.
    throw new Error(`Unknown permission key passed to guard: "${key}"`);
  }
}

/**
 * Returns an Elysia `beforeHandle` that 403s if the user lacks `key`.
 * Must run *after* the auth `.resolve()` that populates userId/userRole.
 */
export function requirePermission(key: string) {
  assertKnownKey(key);
  return async ({ userId, userRole, set }: GuardCtx) => {
    if (!userId || userRole === undefined) return UNAUTHORIZED(set);
    const ok = await userHasPermission(userId, key, { userRole });
    if (!ok) return FORBIDDEN(set, `Missing permission: ${key}`);
  };
}

/**
 * Returns an Elysia `beforeHandle` that 403s unless the user has at least one
 * of `keys`. Useful for shared menu/page entry points (e.g. "any vouchers.*").
 */
export function requireAnyPermission(keys: string[]) {
  for (const k of keys) assertKnownKey(k);
  return async ({ userId, userRole, set }: GuardCtx) => {
    if (!userId || userRole === undefined) return UNAUTHORIZED(set);
    const ok = await userHasAnyPermission(userId, keys, { userRole });
    if (!ok) return FORBIDDEN(set, `Missing any of: ${keys.join(", ")}`);
  };
}

/**
 * Returns an Elysia `beforeHandle` that 403s unless the user has ALL of `keys`.
 * Use sparingly — most actions need just one key.
 */
export function requireAllPermissions(keys: string[]) {
  for (const k of keys) assertKnownKey(k);
  return async ({ userId, userRole, set }: GuardCtx) => {
    if (!userId || userRole === undefined) return UNAUTHORIZED(set);
    const ok = await userHasAllPermissions(userId, keys, { userRole });
    if (!ok) return FORBIDDEN(set, `Missing all of: ${keys.join(", ")}`);
  };
}
