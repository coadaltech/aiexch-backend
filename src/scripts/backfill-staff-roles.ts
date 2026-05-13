/**
 * Backfill: assign every existing non-owner staff user (Admin/Super/Master/Agent)
 * to the "Operations Full Access" template so behavior on day 1 of staff RBAC
 * matches what they had before — they keep every permission except the new
 * staff-management ones (which Owner must explicitly opt them into).
 *
 *   bun run src/scripts/backfill-staff-roles.ts
 *
 * Idempotent: skips users who already have an assignment row in
 * `user_staff_role`. Owners and Users (role=7, players) are never touched.
 *
 * Run order:
 *   1. db:migrate                (creates the new tables)
 *   2. seed:permissions          (populates catalog + system templates)
 *   3. backfill:staff            (this script — preserves current behavior)
 *
 * Re-running after Owner reassigns specific staff to other roles is safe; this
 * script only inserts rows where none exist.
 */

import "dotenv/config";
import { eq, and, isNull, inArray } from "drizzle-orm";

import { db } from "@db/index";
import { users, staffRoles, userStaffRole } from "@db/schema";
import { UserRole, RecordStatus } from "../types/enums";
import { ROLE_TEMPLATES, OPERATIONS_FULL_TEMPLATE_KEY } from "../permissions/role-templates";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  // Find the seeded "Operations Full Access" template (system, global).
  const opsTemplate = ROLE_TEMPLATES.find((t) => t.templateKey === OPERATIONS_FULL_TEMPLATE_KEY);
  if (!opsTemplate) {
    console.error(`Backfill template "${OPERATIONS_FULL_TEMPLATE_KEY}" missing from role-templates.ts`);
    process.exit(1);
  }

  const [opsRole] = await db
    .select()
    .from(staffRoles)
    .where(and(eq(staffRoles.name, opsTemplate.name), isNull(staffRoles.whitelabelId), eq(staffRoles.isSystem, true)))
    .limit(1);

  if (!opsRole) {
    console.error(`System template "${opsTemplate.name}" not found in DB. Run seed:permissions first.`);
    process.exit(1);
  }

  console.log(`Using template "${opsRole.name}" (id=${opsRole.id}) for backfill.`);

  // Eligible staff roles — every role *except* Owner and User.
  const STAFF_ROLES = [UserRole.Admin, UserRole.Super, UserRole.Master, UserRole.Agent];

  const allStaff = await db
    .select({ id: users.id, role: users.role, username: users.username })
    .from(users)
    .where(
      and(
        inArray(users.role, STAFF_ROLES),
        eq(users.recordStatus, RecordStatus.Active),
      ),
    );

  console.log(`Found ${allStaff.length} active staff users (Admin/Super/Master/Agent).`);

  // Skip users who already have an assignment.
  const existingAssignments = await db.select({ userId: userStaffRole.userId }).from(userStaffRole);
  const alreadyAssigned = new Set(existingAssignments.map((r) => r.userId));

  const toAssign = allStaff.filter((u) => !alreadyAssigned.has(u.id));
  if (toAssign.length === 0) {
    console.log("Nothing to backfill — every staff user already has an assignment.");
    process.exit(0);
  }

  console.log(`Assigning ${toAssign.length} user(s) to "${opsRole.name}"...`);
  await db.insert(userStaffRole).values(
    toAssign.map((u) => ({
      userId: u.id,
      staffRoleId: opsRole.id,
      assignedBy: null,
    })),
  );

  console.log("✓ Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
