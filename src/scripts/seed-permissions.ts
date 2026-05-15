/**
 * Idempotent seed script for the staff RBAC system.
 *
 *   bun run src/scripts/seed-permissions.ts
 *
 * Run after every migration. Safe to re-run any number of times — uses upserts
 * keyed on stable text fields (`permissions.key`, `staff_roles.name` for
 * `is_system=true` rows).
 *
 * What it does:
 *   1. Upserts every entry from `permissions/catalog.ts` into `permissions`.
 *   2. Upserts every entry from `permissions/role-templates.ts` into
 *      `staff_roles` with `is_system = true`.
 *   3. Replaces the permission set for each system template (so editing the
 *      catalog or template files and re-seeding stays in sync).
 *
 * Existing user assignments and per-user overrides are NEVER touched.
 */

import "dotenv/config";
import { eq, and, isNull, inArray } from "drizzle-orm";

import { db } from "@db/index";
import { permissions, staffRoles, staffRolePermissions } from "@db/schema";
import { PERMISSIONS } from "../permissions/catalog";
import { ROLE_TEMPLATES } from "../permissions/role-templates";

async function seedPermissions(): Promise<Map<string, string>> {
  console.log(`Seeding ${PERMISSIONS.length} permission keys...`);

  const existing = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const existingByKey = new Map(existing.map((r) => [r.key, r.id]));

  const toInsert = PERMISSIONS.filter((p) => !existingByKey.has(p.key));
  if (toInsert.length > 0) {
    const inserted = await db
      .insert(permissions)
      .values(
        toInsert.map((p) => ({
          key: p.key,
          group: p.group,
          label: p.label,
          description: p.description,
        })),
      )
      .returning({ id: permissions.id, key: permissions.key });
    for (const row of inserted) existingByKey.set(row.key, row.id);
    console.log(`  + inserted ${inserted.length} new permission rows`);
  }

  // Update label/group/description on existing rows so catalog edits propagate.
  for (const p of PERMISSIONS) {
    if (!existingByKey.has(p.key)) continue;
    await db
      .update(permissions)
      .set({ group: p.group, label: p.label, description: p.description })
      .where(eq(permissions.key, p.key));
  }

  console.log(`  permissions table: ${existingByKey.size} rows total`);
  return existingByKey;
}

async function seedRoleTemplates(permIdByKey: Map<string, string>): Promise<void> {
  console.log(`Seeding ${ROLE_TEMPLATES.length} system role templates...`);

  for (const tpl of ROLE_TEMPLATES) {
    // System templates are global (whitelabelId = NULL).
    const [existing] = await db
      .select()
      .from(staffRoles)
      .where(and(eq(staffRoles.name, tpl.name), isNull(staffRoles.whitelabelId), eq(staffRoles.isSystem, true)))
      .limit(1);

    let roleId: string;
    if (existing) {
      roleId = existing.id;
      await db
        .update(staffRoles)
        .set({
          description: tpl.description,
          scopeRole: tpl.scopeRole,
        })
        .where(eq(staffRoles.id, roleId));
    } else {
      const [inserted] = await db
        .insert(staffRoles)
        .values({
          name: tpl.name,
          description: tpl.description,
          scopeRole: tpl.scopeRole,
          whitelabelId: null,
          isSystem: true,
        })
        .returning({ id: staffRoles.id });
      roleId = inserted.id;
      console.log(`  + created template "${tpl.name}"`);
    }

    // Reset the permission mapping to the canonical list.
    await db.delete(staffRolePermissions).where(eq(staffRolePermissions.staffRoleId, roleId));

    const permissionIds = tpl.permissionKeys
      .map((key) => permIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    const missing = tpl.permissionKeys.filter((k) => !permIdByKey.has(k));
    if (missing.length > 0) {
      console.warn(
        `  ! template "${tpl.name}" references ${missing.length} unknown permission key(s): ${missing.join(", ")}`,
      );
    }

    if (permissionIds.length > 0) {
      // De-dupe in case the same key is referenced twice via the helpers.
      const unique = Array.from(new Set(permissionIds));
      await db.insert(staffRolePermissions).values(
        unique.map((permissionId) => ({ staffRoleId: roleId, permissionId })),
      );
    }

    console.log(`  template "${tpl.name}": ${permissionIds.length} permission(s)`);
  }
}

async function pruneOrphanRolePermissions(permIdByKey: Map<string, string>): Promise<void> {
  // If a permission row was somehow deleted manually, drop dangling joins.
  const validIds = Array.from(permIdByKey.values());
  if (validIds.length === 0) return;
  // Postgres ANY() via inArray + NOT — done with a select + delete loop for safety.
  const all = await db.select({ permissionId: staffRolePermissions.permissionId }).from(staffRolePermissions);
  const orphans = all.filter((r) => !validIds.includes(r.permissionId)).map((r) => r.permissionId);
  if (orphans.length > 0) {
    await db.delete(staffRolePermissions).where(inArray(staffRolePermissions.permissionId, orphans));
    console.log(`  pruned ${orphans.length} orphan staff_role_permissions row(s)`);
  }
}

/**
 * Idempotent seed entrypoint that callers (CLI and the backend boot sequence)
 * can both invoke. Doesn't touch process.exit so the caller decides what to do
 * on failure — the boot sequence logs and continues, the CLI rethrows.
 */
export async function runStaffPermissionSeed(): Promise<void> {
  const permIdByKey = await seedPermissions();
  await seedRoleTemplates(permIdByKey);
  await pruneOrphanRolePermissions(permIdByKey);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  console.log("Seeding staff RBAC catalog...");
  try {
    await runStaffPermissionSeed();
    console.log("✓ Seed complete.");
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

// Only auto-run the CLI flow when executed directly (e.g. `bun run seed:permissions`).
// When imported by src/index.ts at startup we just expose runStaffPermissionSeed.
if (import.meta.main) {
  main();
}
