/**
 * Staff management routes.
 *
 * Endpoints (all under /owner):
 *   GET    /permissions                              catalog (read-only)
 *   GET    /staff-roles                              list role templates (scoped)
 *   POST   /staff-roles                              create template
 *   GET    /staff-roles/:id                          fetch one with permission ids
 *   PUT    /staff-roles/:id                          edit name/description/scope_role
 *   PUT    /staff-roles/:id/permissions              replace permission set (bulk)
 *   DELETE /staff-roles/:id                          delete (blocked if assigned/system)
 *   POST   /staff-roles/:id/clone                    clone an existing template
 *
 *   GET    /staff/users/:id                          current assignment + effective perms
 *   PUT    /staff/users/:id/role                     assign or change staff role
 *   DELETE /staff/users/:id/role                     unassign
 *   POST   /staff/users/:id/overrides                upsert single GRANT|DENY override
 *   DELETE /staff/users/:id/overrides/:permissionId  remove an override
 *
 * Scoping rules (enforced inline):
 *   - Owner can manage everything globally.
 *   - Non-owner with staff_roles.* / staff.* can manage only roles whose
 *     `whitelabel_id` matches their own scope, and only assignments to users
 *     within that scope. They also cannot assign a permission they don't
 *     personally hold (privilege-escalation guard).
 */

import { Elysia, t } from "elysia";
import { eq, and, isNull, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  permissions,
  staffRoles,
  staffRolePermissions,
  userStaffRole,
  userPermissionOverrides,
  users,
  profiles,
  SYSTEM_USER_ID,
} from "../../db/schema";
import { UserRole, RecordStatus, MembershipType } from "../../types/enums";
import { resolveOwnerScope } from "../../utils/ownerScope";
import { requirePermission } from "../../middleware/permissions";
import { getEffectivePermissions } from "../../services/permissions";
import { PERMISSION_GROUPS_ORDERED } from "../../permissions/catalog";
import { generateHashPassword } from "../../utils/password";

const canViewPermissions = requirePermission("staff_roles.view");
const canViewStaffRoles = requirePermission("staff_roles.view");
const canCreateStaffRole = requirePermission("staff_roles.create");
const canEditStaffRole = requirePermission("staff_roles.edit");
const canDeleteStaffRole = requirePermission("staff_roles.delete");

const canViewStaff = requirePermission("staff.view");
const canAssignStaffRole = requirePermission("staff.assign_role");
const canManageOverrides = requirePermission("staff.manage_overrides");

/**
 * Return true iff the caller is allowed to see/edit `role` based on scope:
 *   - Owner: any role.
 *   - Non-owner: only whitelabel-scoped roles whose whitelabelId matches theirs.
 *   - System roles (whitelabelId NULL) are visible to non-owners but only
 *     editable/deletable by Owner.
 */
function canAccessRole(
  role: { whitelabelId: string | null; isSystem: boolean },
  callerRole: number,
  callerScopeWlId: string | null,
  mode: "view" | "mutate",
): boolean {
  if (callerRole === UserRole.Owner) return true;
  if (role.whitelabelId === null) {
    // Global / system templates: visible to everyone, mutable only by Owner.
    return mode === "view";
  }
  return role.whitelabelId === callerScopeWlId;
}

/**
 * Returns true iff the caller is allowed to manage `target`'s staff record.
 *
 *   - target must be a staff (is_staff = true).
 *   - target.parent_user_id must match `effectiveCallerId` — the *effective*
 *     caller. For a real tier user this is their own id; for a staff caller
 *     it's the parent's id (so a staff can manage their parent's staff,
 *     never anyone else's).
 *
 * No Owner-bypass: Owner only manages the staff they created (parent matches),
 * just like every other tier. The "scope swap" via resolveOwnerScope is the
 * single mechanism for inheritance.
 */
function canManageStaffMember(
  target: { isStaff: boolean; parentUserId: string | null },
  effectiveCallerId: string,
): boolean {
  if (!target.isStaff) return false;
  return target.parentUserId === effectiveCallerId;
}

/**
 * Privilege-escalation guard: a non-owner cannot grant a permission they
 * don't personally hold. Returns the offending key, or null if all keys pass.
 */
async function findEscalation(
  callerId: string,
  callerRole: number,
  permissionKeys: string[],
): Promise<string | null> {
  if (callerRole === UserRole.Owner) return null;
  const callerPerms = await getEffectivePermissions(callerId, { userRole: callerRole });
  for (const k of permissionKeys) {
    if (!callerPerms.has(k)) return k;
  }
  return null;
}

export const staffRoutes = new Elysia()
  // ── Permission catalog (read-only) ────────────────────────────────────────
  .get("/permissions", async ({ set }) => {
    const rows = await db.select().from(permissions);
    set.status = 200;
    return {
      success: true,
      data: {
        groups: PERMISSION_GROUPS_ORDERED,
        permissions: rows,
      },
    };
  }, { beforeHandle: canViewPermissions })

  // ── Staff Roles: list ─────────────────────────────────────────────────────
  // Owner sees every role template. Non-owner sees: their whitelabel's roles
  // + system templates (read-only).
  .get("/staff-roles", async ({ set, userId, userRole }: any) => {
    const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
    const whereClause =
      userRole === UserRole.Owner
        ? undefined
        : or(
            isNull(staffRoles.whitelabelId),
            scope.scopeWhitelabelId
              ? eq(staffRoles.whitelabelId, scope.scopeWhitelabelId)
              : undefined,
          );
    const baseQuery = db.select().from(staffRoles);
    const rows = whereClause
      ? await baseQuery.where(and(whereClause, eq(staffRoles.recordStatus, RecordStatus.Active)))
      : await baseQuery.where(eq(staffRoles.recordStatus, RecordStatus.Active));
    set.status = 200;
    return { success: true, data: rows };
  }, { beforeHandle: canViewStaffRoles })

  // ── Staff Roles: create ──────────────────────────────────────────────────
  .post(
    "/staff-roles",
    async ({ body, set, userId, userRole }: any) => {
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      // Non-owner: force whitelabelId to their own scope.
      const whitelabelId =
        userRole === UserRole.Owner ? body.whitelabelId ?? null : scope.scopeWhitelabelId;
      if (userRole !== UserRole.Owner && !whitelabelId) {
        set.status = 400;
        return { success: false, message: "No whitelabel scope resolved for caller" };
      }

      // Validate scopeRole — only Admin/Super/Master/Agent are valid targets.
      const validScopeRoles = [UserRole.Admin, UserRole.Super, UserRole.Master, UserRole.Agent];
      if (!validScopeRoles.includes(body.scopeRole)) {
        set.status = 400;
        return { success: false, message: "Invalid scope_role" };
      }

      // Privilege escalation guard.
      const escalation = await findEscalation(userId, userRole, body.permissionKeys ?? []);
      if (escalation) {
        set.status = 403;
        return {
          success: false,
          message: `You cannot grant a permission you don't hold: ${escalation}`,
        };
      }

      // Resolve permission keys to ids.
      const permRows = await db
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, body.permissionKeys ?? []));
      const permIdMap = new Map(permRows.map((r) => [r.key, r.id]));

      const [created] = await db
        .insert(staffRoles)
        .values({
          name: body.name,
          description: body.description ?? null,
          scopeRole: body.scopeRole,
          whitelabelId: whitelabelId,
          isSystem: false,
          createdBy: userId,
          addedBy: userId,
          updateBy: userId,
        })
        .returning();

      const ids = (body.permissionKeys ?? [])
        .map((k: string) => permIdMap.get(k))
        .filter((id: string | undefined): id is string => Boolean(id));
      if (ids.length > 0) {
        await db.insert(staffRolePermissions).values(
          ids.map((permissionId: string) => ({ staffRoleId: created.id, permissionId })),
        );
      }
      set.status = 201;
      return { success: true, data: created };
    },
    {
      beforeHandle: canCreateStaffRole,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        description: t.Optional(t.String()),
        scopeRole: t.Number(),
        whitelabelId: t.Optional(t.Union([t.String(), t.Null()])),
        permissionKeys: t.Optional(t.Array(t.String())),
      }),
    },
  )

  // ── Staff Roles: fetch one with its permission ids ────────────────────────
  .get(
    "/staff-roles/:id",
    async ({ params, set, userId, userRole }: any) => {
      const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, params.id)).limit(1);
      if (!role) {
        set.status = 404;
        return { success: false, message: "Role not found" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canAccessRole(role, userRole, scope.scopeWhitelabelId, "view")) {
        set.status = 404;
        return { success: false, message: "Role not found" };
      }
      const perms = await db
        .select({ id: permissions.id, key: permissions.key, group: permissions.group, label: permissions.label })
        .from(staffRolePermissions)
        .innerJoin(permissions, eq(permissions.id, staffRolePermissions.permissionId))
        .where(eq(staffRolePermissions.staffRoleId, role.id));
      set.status = 200;
      return { success: true, data: { ...role, permissions: perms } };
    },
    { beforeHandle: canViewStaffRoles },
  )

  // ── Staff Roles: edit name/description/scope ─────────────────────────────
  .put(
    "/staff-roles/:id",
    async ({ params, body, set, userId, userRole }: any) => {
      const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, params.id)).limit(1);
      if (!role) {
        set.status = 404;
        return { success: false, message: "Role not found" };
      }
      if (role.isSystem && userRole !== UserRole.Owner) {
        set.status = 403;
        return { success: false, message: "System templates can only be edited by Owner" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canAccessRole(role, userRole, scope.scopeWhitelabelId, "mutate")) {
        set.status = 403;
        return { success: false, message: "Not authorized to edit this role" };
      }
      const update: Record<string, unknown> = { updateBy: userId, updateDate: new Date() };
      if (body.name !== undefined) update.name = body.name;
      if (body.description !== undefined) update.description = body.description;
      if (body.scopeRole !== undefined) update.scopeRole = body.scopeRole;
      const [updated] = await db
        .update(staffRoles)
        .set(update)
        .where(eq(staffRoles.id, params.id))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      beforeHandle: canEditStaffRole,
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        scopeRole: t.Optional(t.Number()),
      }),
    },
  )

  // ── Staff Roles: replace permission set (bulk) ───────────────────────────
  .put(
    "/staff-roles/:id/permissions",
    async ({ params, body, set, userId, userRole }: any) => {
      const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, params.id)).limit(1);
      if (!role) {
        set.status = 404;
        return { success: false, message: "Role not found" };
      }
      if (role.isSystem && userRole !== UserRole.Owner) {
        set.status = 403;
        return { success: false, message: "System templates can only be edited by Owner" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canAccessRole(role, userRole, scope.scopeWhitelabelId, "mutate")) {
        set.status = 403;
        return { success: false, message: "Not authorized to edit this role" };
      }
      const escalation = await findEscalation(userId, userRole, body.permissionKeys);
      if (escalation) {
        set.status = 403;
        return {
          success: false,
          message: `You cannot grant a permission you don't hold: ${escalation}`,
        };
      }
      const permRows = await db
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, body.permissionKeys));
      const ids = Array.from(new Set(permRows.map((r) => r.id)));
      await db.transaction(async (tx) => {
        await tx.delete(staffRolePermissions).where(eq(staffRolePermissions.staffRoleId, role.id));
        if (ids.length > 0) {
          await tx.insert(staffRolePermissions).values(
            ids.map((permissionId) => ({ staffRoleId: role.id, permissionId })),
          );
        }
        await tx
          .update(staffRoles)
          .set({ updateBy: userId, updateDate: new Date() })
          .where(eq(staffRoles.id, role.id));
      });
      set.status = 200;
      return { success: true, data: { count: ids.length } };
    },
    {
      beforeHandle: canEditStaffRole,
      body: t.Object({ permissionKeys: t.Array(t.String()) }),
    },
  )

  // ── Staff Roles: delete ──────────────────────────────────────────────────
  .delete("/staff-roles/:id", async ({ params, set, userId, userRole }: any) => {
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, params.id)).limit(1);
    if (!role) {
      set.status = 404;
      return { success: false, message: "Role not found" };
    }
    if (role.isSystem) {
      set.status = 403;
      return { success: false, message: "System templates cannot be deleted" };
    }
    const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
    if (!canAccessRole(role, userRole, scope.scopeWhitelabelId, "mutate")) {
      set.status = 403;
      return { success: false, message: "Not authorized to delete this role" };
    }
    // Block delete if any users are assigned.
    const assignments = await db
      .select({ userId: userStaffRole.userId })
      .from(userStaffRole)
      .where(eq(userStaffRole.staffRoleId, role.id))
      .limit(1);
    if (assignments.length > 0) {
      set.status = 409;
      return {
        success: false,
        message: "Reassign staff using this role before deleting it",
      };
    }
    await db.delete(staffRoles).where(eq(staffRoles.id, role.id));
    set.status = 200;
    return { success: true };
  }, { beforeHandle: canDeleteStaffRole })

  // ── Staff Roles: clone an existing template into a new editable copy ─────
  .post(
    "/staff-roles/:id/clone",
    async ({ params, body, set, userId, userRole }: any) => {
      const [source] = await db.select().from(staffRoles).where(eq(staffRoles.id, params.id)).limit(1);
      if (!source) {
        set.status = 404;
        return { success: false, message: "Source role not found" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canAccessRole(source, userRole, scope.scopeWhitelabelId, "view")) {
        set.status = 404;
        return { success: false, message: "Source role not found" };
      }

      // Resolve target whitelabelId for the clone.
      const targetWlId =
        userRole === UserRole.Owner
          ? body?.whitelabelId ?? source.whitelabelId
          : scope.scopeWhitelabelId;

      const [clone] = await db
        .insert(staffRoles)
        .values({
          name: body?.name ?? `${source.name} (copy)`,
          description: source.description,
          scopeRole: source.scopeRole,
          whitelabelId: targetWlId,
          isSystem: false,
          createdBy: userId,
          addedBy: userId,
          updateBy: userId,
        })
        .returning();

      const sourcePerms = await db
        .select({ permissionId: staffRolePermissions.permissionId })
        .from(staffRolePermissions)
        .where(eq(staffRolePermissions.staffRoleId, source.id));
      if (sourcePerms.length > 0) {
        await db.insert(staffRolePermissions).values(
          sourcePerms.map((p) => ({ staffRoleId: clone.id, permissionId: p.permissionId })),
        );
      }
      set.status = 201;
      return { success: true, data: clone };
    },
    {
      beforeHandle: canCreateStaffRole,
      body: t.Optional(
        t.Object({
          name: t.Optional(t.String()),
          whitelabelId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      ),
    },
  )

  // ── Staff: list MY staff. Filters by parent_user_id = effective caller.
  // For a real tier user this is the caller's own id; for a staff caller it's
  // the parent's id (so the staff sees the same list their parent sees). ───
  .get("/staff/list", async ({ set, userId, userRole }: any) => {
    const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
    const baseSelect = {
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      whitelabelId: users.whitelabelId,
      accountStatus: users.accountStatus,
      parentUserId: users.parentUserId,
      isStaff: users.isStaff,
      addedDate: users.addedDate,
    };
    const rows = await db
      .select(baseSelect)
      .from(users)
      .where(
        and(
          eq(users.isStaff, true),
          eq(users.recordStatus, RecordStatus.Active),
          eq(users.parentUserId, scope.currentUserId),
        ),
      );
    set.status = 200;
    return { success: true, data: rows };
  }, { beforeHandle: canViewStaff })

  // ── Staff: create a new staff user under the EFFECTIVE caller ──────────
  // When a staff member with the create permission calls this endpoint, the
  // new user is attributed to their parent — so the parent's list sees them
  // and the role mirrors the parent's tier. Audit columns still record the
  // actual actor (the staff member) for traceability.
  //
  // The new user's permissions start empty; the caller (or any peer with
  // permission) must assign a role / grants on the Manage screen.
  .post(
    "/staff/create",
    async ({ body, set, userId, userRole }: any) => {
      const [actor] = await db
        .select({
          isStaff: users.isStaff,
          whitelabelId: users.whitelabelId,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!actor) {
        set.status = 401;
        return { success: false, message: "Not authenticated" };
      }

      // Effective scope = parent if caller is a staff, else self. The new
      // staff is attributed to whichever tier user this resolves to, so the
      // org chart stays one level deep (tier-user → staff, no chains).
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });

      const username = String(body.username ?? "").trim().toLowerCase();
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!username || !email || !body.password) {
        set.status = 400;
        return { success: false, message: "username, email and password are required" };
      }

      // Uniqueness (case-insensitive).
      const [existingByUsername] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = ${username}`)
        .limit(1);
      if (existingByUsername) {
        set.status = 409;
        return { success: false, message: "Username already taken" };
      }
      const [existingByEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (existingByEmail) {
        set.status = 409;
        return { success: false, message: "Email already in use" };
      }

      const hashedPassword = await generateHashPassword(body.password);

      // Inherit whitelabel from the EFFECTIVE parent (staff caller → parent's
      // whitelabel), and mirror the effective parent's role.
      const [parentWl] = scope.currentUserId !== userId
        ? await db
            .select({ whitelabelId: users.whitelabelId })
            .from(users)
            .where(eq(users.id, scope.currentUserId))
            .limit(1)
        : [{ whitelabelId: actor.whitelabelId }];

      const [created] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          role: scope.currentUserRole,
          groupId: scope.currentUserRole,
          whitelabelId: parentWl?.whitelabelId ?? actor.whitelabelId,
          isStaff: true,
          parentUserId: scope.currentUserId,
          emailVerified: true,
          createdBy: userId,
          addedBy: userId,
          updateBy: userId,
        })
        .returning({
          id: users.id,
          username: users.username,
          email: users.email,
          role: users.role,
        });

      // Minimum profile row so /profile/me has something to read.
      await db.insert(profiles).values({
        userId: created.id,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        membership: MembershipType.Bronze,
        addedBy: userId,
        updateBy: userId,
      });

      set.status = 201;
      return { success: true, data: created };
    },
    {
      beforeHandle: canAssignStaffRole,
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ minLength: 5, maxLength: 255 }),
        password: t.String({ minLength: 6, maxLength: 100 }),
        firstName: t.Optional(t.String({ maxLength: 100 })),
        lastName: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  )

  // ── Staff: get assignment + effective permissions for a user ─────────────
  .get("/staff/users/:id", async ({ params, set, userId, userRole }: any) => {
    const [target] = await db
      .select({
        id: users.id,
        role: users.role,
        whitelabelId: users.whitelabelId,
        username: users.username,
        isStaff: users.isStaff,
        parentUserId: users.parentUserId,
      })
      .from(users)
      .where(eq(users.id, params.id))
      .limit(1);
    if (!target) {
      set.status = 404;
      return { success: false, message: "User not found" };
    }
    const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
    if (!canManageStaffMember(target, scope.currentUserId)) {
      set.status = 403;
      return { success: false, message: "Not authorized to manage this staff member" };
    }
    const [assignment] = await db
      .select()
      .from(userStaffRole)
      .where(eq(userStaffRole.userId, target.id))
      .limit(1);

    let role: typeof staffRoles.$inferSelect | null = null;
    if (assignment) {
      [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, assignment.staffRoleId)).limit(1) as any;
    }

    const overrides = await db
      .select({
        permissionId: userPermissionOverrides.permissionId,
        effect: userPermissionOverrides.effect,
        permissionKey: permissions.key,
      })
      .from(userPermissionOverrides)
      .innerJoin(permissions, eq(permissions.id, userPermissionOverrides.permissionId))
      .where(eq(userPermissionOverrides.userId, target.id));

    const effective = await getEffectivePermissions(target.id, { userRole: target.role });
    set.status = 200;
    return {
      success: true,
      data: {
        user: target,
        role,
        overrides,
        effectivePermissions: Array.from(effective),
      },
    };
  }, { beforeHandle: canViewStaff })

  // ── Staff: assign or change role ─────────────────────────────────────────
  .put(
    "/staff/users/:id/role",
    async ({ params, body, set, userId, userRole }: any) => {
      const [target] = await db
        .select({
          id: users.id,
          role: users.role,
          whitelabelId: users.whitelabelId,
          isStaff: users.isStaff,
          parentUserId: users.parentUserId,
        })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canManageStaffMember(target, scope.currentUserId)) {
        set.status = 403;
        return { success: false, message: "Not authorized to manage this staff member" };
      }
      if (target.role === UserRole.User) {
        set.status = 400;
        return { success: false, message: "Staff roles cannot be assigned to regular users" };
      }

      const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, body.staffRoleId)).limit(1);
      if (!role) {
        set.status = 404;
        return { success: false, message: "Staff role not found" };
      }
      if (!canAccessRole(role, userRole, scope.scopeWhitelabelId, "view")) {
        set.status = 404;
        return { success: false, message: "Staff role not found" };
      }
      // (Scope-by-whitelabel check removed — canManageStaffMember above
      //  already restricts non-Owners to staff whose parent_user_id matches.)

      // Privilege escalation: caller must hold every permission in the role.
      const rolePermKeys = await db
        .select({ key: permissions.key })
        .from(staffRolePermissions)
        .innerJoin(permissions, eq(permissions.id, staffRolePermissions.permissionId))
        .where(eq(staffRolePermissions.staffRoleId, role.id));
      const escalation = await findEscalation(
        userId,
        userRole,
        rolePermKeys.map((r) => r.key),
      );
      if (escalation) {
        set.status = 403;
        return {
          success: false,
          message: `You cannot grant a role containing a permission you don't hold: ${escalation}`,
        };
      }

      // Upsert: delete-then-insert.
      await db.transaction(async (tx) => {
        await tx.delete(userStaffRole).where(eq(userStaffRole.userId, target.id));
        await tx.insert(userStaffRole).values({
          userId: target.id,
          staffRoleId: role.id,
          assignedBy: userId,
        });
      });
      // Bump the target's session token so their /profile/me on next refresh
      // pulls the new effective permissions.
      await db.update(users).set({ sessionToken: crypto.randomUUID() }).where(eq(users.id, target.id));
      set.status = 200;
      return { success: true, data: { userId: target.id, staffRoleId: role.id } };
    },
    {
      beforeHandle: canAssignStaffRole,
      body: t.Object({ staffRoleId: t.String() }),
    },
  )

  // ── Staff: unassign ──────────────────────────────────────────────────────
  .delete("/staff/users/:id/role", async ({ params, set, userId, userRole }: any) => {
    const [target] = await db
      .select({
        id: users.id,
        whitelabelId: users.whitelabelId,
        isStaff: users.isStaff,
        parentUserId: users.parentUserId,
      })
      .from(users)
      .where(eq(users.id, params.id))
      .limit(1);
    if (!target) {
      set.status = 404;
      return { success: false, message: "User not found" };
    }
    const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
    if (!canManageStaffMember(target, scope.currentUserId)) {
      set.status = 403;
      return { success: false, message: "Not authorized to manage this staff member" };
    }
    await db.delete(userStaffRole).where(eq(userStaffRole.userId, target.id));
    await db.update(users).set({ sessionToken: crypto.randomUUID() }).where(eq(users.id, target.id));
    set.status = 200;
    return { success: true };
  }, { beforeHandle: canAssignStaffRole })

  // ── Staff: upsert single override (GRANT or DENY) ────────────────────────
  .post(
    "/staff/users/:id/overrides",
    async ({ params, body, set, userId, userRole }: any) => {
      const [target] = await db
        .select({
          id: users.id,
          whitelabelId: users.whitelabelId,
          role: users.role,
          isStaff: users.isStaff,
          parentUserId: users.parentUserId,
        })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canManageStaffMember(target, scope.currentUserId)) {
        set.status = 403;
        return { success: false, message: "Not authorized to manage this staff member" };
      }

      const effect = String(body.effect).toUpperCase();
      if (effect !== "GRANT" && effect !== "DENY") {
        set.status = 400;
        return { success: false, message: "effect must be GRANT or DENY" };
      }

      // For GRANT, run the privilege-escalation guard.
      if (effect === "GRANT") {
        const escalation = await findEscalation(userId, userRole, [body.permissionKey]);
        if (escalation) {
          set.status = 403;
          return {
            success: false,
            message: `You cannot grant a permission you don't hold: ${escalation}`,
          };
        }
      }

      const [perm] = await db
        .select()
        .from(permissions)
        .where(eq(permissions.key, body.permissionKey))
        .limit(1);
      if (!perm) {
        set.status = 404;
        return { success: false, message: "Permission key not found" };
      }

      // Upsert (delete-then-insert) since (user_id, permission_id) is unique.
      await db.transaction(async (tx) => {
        await tx
          .delete(userPermissionOverrides)
          .where(
            and(
              eq(userPermissionOverrides.userId, target.id),
              eq(userPermissionOverrides.permissionId, perm.id),
            ),
          );
        await tx.insert(userPermissionOverrides).values({
          userId: target.id,
          permissionId: perm.id,
          effect,
          grantedBy: userId,
        });
      });
      await db.update(users).set({ sessionToken: crypto.randomUUID() }).where(eq(users.id, target.id));
      set.status = 200;
      return { success: true };
    },
    {
      beforeHandle: canManageOverrides,
      body: t.Object({
        permissionKey: t.String(),
        effect: t.String(), // "GRANT" | "DENY"
      }),
    },
  )

  // ── Staff: remove a specific override ────────────────────────────────────
  .delete(
    "/staff/users/:id/overrides/:permissionId",
    async ({ params, set, userId, userRole }: any) => {
      const [target] = await db
        .select({
          id: users.id,
          whitelabelId: users.whitelabelId,
          isStaff: users.isStaff,
          parentUserId: users.parentUserId,
        })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      const scope = await resolveOwnerScope(db, undefined, { id: userId, role: userRole });
      if (!canManageStaffMember(target, scope.currentUserId)) {
        set.status = 403;
        return { success: false, message: "Not authorized to manage this staff member" };
      }
      await db
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, target.id),
            eq(userPermissionOverrides.permissionId, params.permissionId),
          ),
        );
      await db.update(users).set({ sessionToken: crypto.randomUUID() }).where(eq(users.id, target.id));
      set.status = 200;
      return { success: true };
    },
    { beforeHandle: canManageOverrides },
  );
