/**
 * Default staff role templates seeded with `is_system = true`.
 *
 * These are global (whitelabelId = NULL) and cloneable. Owners may edit them
 * (toggle individual permissions) but may not delete system templates.
 *
 * The `permissionKeys` list refers to keys in `permissions/catalog.ts`. The
 * seed script resolves each key to a permission ID.
 *
 * `OPERATIONS_FULL_TEMPLATE_KEY` is special: it's the role auto-assigned to
 * every existing non-owner user during the backfill, so behavior on day 1
 * matches what they had before staff RBAC existed. It includes every permission
 * that isn't `staff.*` / `staff_roles.*` (admins shouldn't manage staff
 * roles by default — owners must explicitly opt them in).
 */

import { UserRole } from "../types/enums";
import { PERMISSIONS, type PermissionDefinition } from "./catalog";

export interface StaffRoleTemplate {
  /** Stable key used by the seed script for upsert. */
  templateKey: string;
  name: string;
  description: string;
  /** Which user-tier this template targets (Admin/Super/Master/Agent). */
  scopeRole: UserRole;
  /** Permission keys granted by this template. */
  permissionKeys: string[];
}

const allKeysExcept = (excluded: string[]): string[] => {
  const set = new Set(excluded);
  return PERMISSIONS.filter((p) => !p.deprecated && !set.has(p.key)).map((p) => p.key);
};

const keysByGroup = (groups: PermissionDefinition["group"][]): string[] => {
  const set = new Set(groups);
  return PERMISSIONS.filter((p) => !p.deprecated && set.has(p.group)).map((p) => p.key);
};

const viewOnlyKeys = (): string[] =>
  PERMISSIONS.filter(
    (p) => !p.deprecated && /\.(view|view_summary|view_details|view_bets)$/.test(p.key),
  ).map((p) => p.key);

/** Special key: the backfill role granted to existing non-owner users. */
export const OPERATIONS_FULL_TEMPLATE_KEY = "operations_full";

/**
 * Permission keys that were Owner-ONLY before staff RBAC was introduced.
 * The backfill template MUST exclude these so existing Admin/Super/Master/Agent
 * users don't gain access they didn't previously have.
 *
 * Sources audited (commit-level grep at the time of writing):
 *   - routes/owner/banners.ts        → all mutations (entire route)
 *   - routes/owner/popups.ts         → all mutations (entire route)
 *   - routes/owner/promotions.ts     → all mutations (entire route)
 *   - routes/owner/promocodes.ts     → all mutations (entire route)
 *   - routes/owner/currencies.ts     → mutations only (view is open)
 *   - routes/owner/whitelabels.ts    → create/edit/delete/assign (list is open)
 *   - routes/owner/matka.ts          → ownerOnly applied to shift/result mutations
 *   - routes/owner/jambo.ts          → ditto
 *   - routes/owner/kalyan-new.ts     → ditto
 *   - routes/owner/settings.ts       → no role guard at API level (UI hides it)
 */
const OWNER_ONLY_KEYS_PRE_RBAC: string[] = [
  // Marketing — Owner only
  "promotions.view", "promotions.create", "promotions.edit", "promotions.delete",
  "promocodes.view", "promocodes.create", "promocodes.edit", "promocodes.delete",
  "banners.view",    "banners.create",    "banners.edit",    "banners.delete",
  "popups.view",     "popups.create",     "popups.edit",     "popups.delete",
  // Currency — list/view stays open, mutations Owner-only
  "currency.create", "currency.edit", "currency.delete", "currency.set_rates",
  // Whitelabels — list stays open, mutations Owner-only
  "whitelabels.create", "whitelabels.edit", "whitelabels.delete", "whitelabels.assign_admin",
  // Matka / Jambo / Kalyan — view stays open, shift CRUD Owner-only
  "matka.create", "matka.edit", "matka.delete", "matka.reorder",
  "jambo.create", "jambo.edit", "jambo.delete", "jambo.reorder",
  "kalyan.create", "kalyan.edit", "kalyan.delete", "kalyan.reorder",
  // Live prediction / sports result — UI shows them as Owner-only, declaring
  // results affects accounting. Conservatively keep the declare/edit verbs
  // out of the backfill set so existing admins can't suddenly post results.
  "live_prediction.declare",
  "sports_result.declare",
  "sports_result.edit",
];

export const ROLE_TEMPLATES: StaffRoleTemplate[] = [
  // Backfill template — mirrors pre-RBAC non-owner access exactly.
  // Excludes staff-management (new feature, opt-in) and every permission that
  // was Owner-only before the migration. Owner role bypasses this entirely.
  {
    templateKey: OPERATIONS_FULL_TEMPLATE_KEY,
    name: "Operations Full Access",
    description:
      "Auto-assigned to existing Admin/Super/Master/Agent users during the migration to preserve their pre-RBAC behavior, plus the ability to manage their own staff. Excludes Owner-only operations (marketing, currency mutations, whitelabel mutations, matka/jambo/kalyan shift CRUD, result declaration).",
    scopeRole: UserRole.Admin,
    // Staff management is scoped to the caller's own staff (parent_user_id = caller),
    // so it's safe to include for every tier — admins can manage *their* staff,
    // never anyone else's.
    permissionKeys: allKeysExcept(OWNER_ONLY_KEYS_PRE_RBAC),
  },

  {
    templateKey: "sports_manager",
    name: "Sports Manager",
    description: "Manages sports, competitions, live markets, results, and custom markets.",
    scopeRole: UserRole.Admin,
    permissionKeys: [
      "dashboard.view",
      ...keysByGroup([
        "Sports",
        "Sports Result",
        "Live Markets",
        "Live Prediction",
        "Custom Markets",
        "Matka",
        "Jambo",
        "Kalyan",
      ]),
    ],
  },

  {
    templateKey: "finance_manager",
    name: "Finance Manager",
    description: "Handles vouchers, withdrawals, KYC, account statements, and currency view.",
    scopeRole: UserRole.Admin,
    permissionKeys: [
      "dashboard.view",
      "users.view",
      "currency.view",
      ...keysByGroup([
        "Account Statement",
        "Vouchers",
        "Withdrawal Methods",
        "KYC",
      ]),
    ],
  },

  {
    templateKey: "marketing_manager",
    name: "Marketing Manager",
    description: "Manages promotions, promo codes, banners, popups, notifications, and homepage sections.",
    scopeRole: UserRole.Admin,
    permissionKeys: [
      "dashboard.view",
      ...keysByGroup([
        "Marketing",
        "Notifications",
        "Home Sections",
      ]),
    ],
  },

  {
    templateKey: "user_manager",
    name: "User Manager",
    description: "Manages user accounts, KYC verification, and views account statements.",
    scopeRole: UserRole.Admin,
    permissionKeys: [
      "dashboard.view",
      ...keysByGroup(["Users", "KYC"]),
      "account_statement.view",
    ],
  },

  {
    templateKey: "operations_readonly",
    name: "Operations Read-only",
    description: "Audit role — can view every page but cannot modify anything.",
    scopeRole: UserRole.Admin,
    permissionKeys: viewOnlyKeys(),
  },
];
