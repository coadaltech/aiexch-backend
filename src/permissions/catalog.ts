/**
 * Single source of truth for every permission key in the system.
 *
 * Convention: `<resource>.<action>` — resource is snake_case_singular,
 * action is one of: view, create, edit, delete, plus resource-specific
 * verbs (declare, approve, reject, settle, sync, etc.).
 *
 * Adding a new permission?
 *   1. Add the entry below.
 *   2. Run the seed script (src/scripts/seed-permissions.ts).
 *   3. The new key is upserted into the DB; existing rows are left alone.
 *
 * Removing a permission?
 *   Mark with `deprecated: true` — never delete, since existing role
 *   templates and overrides reference these by ID.
 */

export type PermissionGroup =
  | "Dashboard"
  | "Users"
  | "Account Statement"
  | "Sports"
  | "Sports Result"
  | "Live Markets"
  | "Transaction Management"
  | "Live Prediction"
  | "Custom Markets"
  | "Matka"
  | "Jambo"
  | "Bombay Bazar"
  | "Home Sections"
  | "Marketing"
  | "Vouchers"
  | "Notifications"
  | "KYC"
  | "Currency"
  | "Whitelabels"
  | "Withdrawal Methods"
  | "QR Codes"
  | "Settings"
  | "Domains"
  | "Staff Management";

export interface PermissionDefinition {
  key: string;
  group: PermissionGroup;
  label: string;
  description: string;
  deprecated?: boolean;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // ── Dashboard ─────────────────────────────────────────────────────────────
  { key: "dashboard.view", group: "Dashboard", label: "View Dashboard", description: "Access the owner panel home/dashboard" },

  // ── Users ─────────────────────────────────────────────────────────────────
  { key: "users.view", group: "Users", label: "View Users", description: "List and view user accounts within scope" },
  { key: "users.create", group: "Users", label: "Create User", description: "Add new users (subject to role hierarchy)" },
  { key: "users.edit", group: "Users", label: "Edit User", description: "Modify user details, profile, settings" },
  { key: "users.delete", group: "Users", label: "Delete User", description: "Soft-delete user accounts" },
  { key: "users.status_toggle", group: "Users", label: "Toggle Status", description: "Suspend or reactivate user accounts" },
  { key: "users.set_limit", group: "Users", label: "Set Limits", description: "Set transaction/exposure limits on users" },
  { key: "users.reset_password", group: "Users", label: "Reset Password", description: "Reset a user's password" },

  // ── Account Statement ─────────────────────────────────────────────────────
  { key: "account_statement.view", group: "Account Statement", label: "View Statement", description: "View ledger/transaction history" },
  { key: "account_statement.export", group: "Account Statement", label: "Export Statement", description: "Export account statements" },

  // ── Sports / Games ────────────────────────────────────────────────────────
  { key: "sports.view", group: "Sports", label: "View Sports", description: "View sports/games list" },
  { key: "sports.create", group: "Sports", label: "Create Sport", description: "Add a new sport/game" },
  { key: "sports.edit", group: "Sports", label: "Edit Sport", description: "Edit sport details" },
  { key: "sports.delete", group: "Sports", label: "Delete Sport", description: "Remove a sport" },
  { key: "sports.reorder", group: "Sports", label: "Reorder Sports", description: "Reorder sport sort order" },
  { key: "sports.toggle", group: "Sports", label: "Toggle Sport Active", description: "Enable/disable a sport" },
  { key: "sports.fetch_competitions", group: "Sports", label: "Fetch Competitions", description: "Sync competitions from external API" },

  // ── Sports Result ─────────────────────────────────────────────────────────
  { key: "sports_result.view", group: "Sports Result", label: "View Sports Results", description: "View declared sports results" },
  { key: "sports_result.declare", group: "Sports Result", label: "Declare Result", description: "Declare a sports event result" },
  { key: "sports_result.edit", group: "Sports Result", label: "Edit Result", description: "Edit a declared result" },

  // ── Live Markets ──────────────────────────────────────────────────────────
  { key: "live_markets.view_summary", group: "Live Markets", label: "View Summary", description: "View live markets summary across events" },
  { key: "live_markets.view_details", group: "Live Markets", label: "View Details", description: "Drill into market exposure detail" },
  { key: "live_markets.view_bets", group: "Live Markets", label: "View Bets", description: "View bets placed on a market" },
  { key: "live_markets.settle", group: "Live Markets", label: "Settle Market", description: "Settle markets manually" },

  // ── Transaction Management ────────────────────────────────────────────────
  { key: "transaction_management.view", group: "Transaction Management", label: "View Transactions", description: "Search bets/transactions by event, market and time range" },
  { key: "transaction_management.delete", group: "Transaction Management", label: "Delete Transactions", description: "Mark transactions as deleted (soft-delete) with a reason to revert a market" },

  // ── Live Prediction ───────────────────────────────────────────────────────
  { key: "live_prediction.view", group: "Live Prediction", label: "View Predictions", description: "View live prediction markets" },
  { key: "live_prediction.declare", group: "Live Prediction", label: "Declare Prediction", description: "Declare prediction outcomes" },

  // ── Custom Markets ────────────────────────────────────────────────────────
  { key: "custom_markets.view", group: "Custom Markets", label: "View Custom Markets", description: "View custom betting markets" },
  { key: "custom_markets.create", group: "Custom Markets", label: "Create Market", description: "Add a custom market" },
  { key: "custom_markets.edit", group: "Custom Markets", label: "Edit Market", description: "Edit a custom market" },
  { key: "custom_markets.delete", group: "Custom Markets", label: "Delete Market", description: "Delete a custom market" },
  { key: "custom_markets.manage_odds", group: "Custom Markets", label: "Manage Odds", description: "Set/adjust market odds" },
  { key: "market_notice.manage", group: "Custom Markets", label: "Manage Market Notice", description: "Add or edit the notice/remark shown to users on a market" },

  // ── Matka ─────────────────────────────────────────────────────────────────
  { key: "matka.view", group: "Matka", label: "View Matka", description: "View matka shifts and timings" },
  { key: "matka.create", group: "Matka", label: "Create Matka Shift", description: "Add a matka shift" },
  { key: "matka.edit", group: "Matka", label: "Edit Matka Shift", description: "Edit matka shift" },
  { key: "matka.delete", group: "Matka", label: "Delete Matka Shift", description: "Delete matka shift" },
  { key: "matka.reorder", group: "Matka", label: "Reorder Matka", description: "Reorder matka shifts" },

  // ── Jambo ─────────────────────────────────────────────────────────────────
  { key: "jambo.view", group: "Jambo", label: "View Jambo", description: "View jambo shifts" },
  { key: "jambo.create", group: "Jambo", label: "Create Jambo Shift", description: "Add a jambo shift" },
  { key: "jambo.edit", group: "Jambo", label: "Edit Jambo Shift", description: "Edit jambo shift" },
  { key: "jambo.delete", group: "Jambo", label: "Delete Jambo Shift", description: "Delete jambo shift" },
  { key: "jambo.reorder", group: "Jambo", label: "Reorder Jambo", description: "Reorder jambo shifts" },

  // ── Bombay Bazar ────────────────────────────────────────────────────────────────
  { key: "bombay-bazar.view", group: "Bombay Bazar", label: "View Bombay Bazar", description: "View bombay-bazar shifts" },
  { key: "bombay-bazar.create", group: "Bombay Bazar", label: "Create Bombay Bazar Shift", description: "Add a bombay-bazar shift" },
  { key: "bombay-bazar.edit", group: "Bombay Bazar", label: "Edit Bombay Bazar Shift", description: "Edit bombay-bazar shift" },
  { key: "bombay-bazar.delete", group: "Bombay Bazar", label: "Delete Bombay Bazar Shift", description: "Delete bombay-bazar shift" },
  { key: "bombay-bazar.reorder", group: "Bombay Bazar", label: "Reorder Bombay Bazar", description: "Reorder bombay-bazar shifts" },

  // ── Home Sections ─────────────────────────────────────────────────────────
  { key: "home_sections.view", group: "Home Sections", label: "View Home Sections", description: "View homepage content sections" },
  { key: "home_sections.create", group: "Home Sections", label: "Create Section", description: "Add a homepage section" },
  { key: "home_sections.edit", group: "Home Sections", label: "Edit Section", description: "Edit a homepage section" },
  { key: "home_sections.delete", group: "Home Sections", label: "Delete Section", description: "Delete a homepage section" },
  { key: "home_sections.reorder", group: "Home Sections", label: "Reorder Sections", description: "Reorder homepage sections" },
  { key: "home_sections.manage_games", group: "Home Sections", label: "Manage Games", description: "Add/remove games inside a section" },

  // ── Marketing — Promotions ────────────────────────────────────────────────
  { key: "promotions.view", group: "Marketing", label: "View Promotions", description: "View promotions" },
  { key: "promotions.create", group: "Marketing", label: "Create Promotion", description: "Add a promotion" },
  { key: "promotions.edit", group: "Marketing", label: "Edit Promotion", description: "Edit a promotion" },
  { key: "promotions.delete", group: "Marketing", label: "Delete Promotion", description: "Delete a promotion" },

  // ── Marketing — Promo Codes ───────────────────────────────────────────────
  { key: "promocodes.view", group: "Marketing", label: "View Promo Codes", description: "View promo code campaigns" },
  { key: "promocodes.create", group: "Marketing", label: "Create Promo Code", description: "Create a promo code" },
  { key: "promocodes.edit", group: "Marketing", label: "Edit Promo Code", description: "Edit a promo code" },
  { key: "promocodes.delete", group: "Marketing", label: "Delete Promo Code", description: "Delete a promo code" },

  // ── Marketing — Banners ───────────────────────────────────────────────────
  { key: "banners.view", group: "Marketing", label: "View Banners", description: "View banners" },
  { key: "banners.create", group: "Marketing", label: "Create Banner", description: "Upload a new banner" },
  { key: "banners.edit", group: "Marketing", label: "Edit Banner", description: "Edit an existing banner" },
  { key: "banners.delete", group: "Marketing", label: "Delete Banner", description: "Delete a banner" },

  // ── Marketing — Popups ────────────────────────────────────────────────────
  { key: "popups.view", group: "Marketing", label: "View Popups", description: "View popups" },
  { key: "popups.create", group: "Marketing", label: "Create Popup", description: "Add a popup" },
  { key: "popups.edit", group: "Marketing", label: "Edit Popup", description: "Edit a popup" },
  { key: "popups.delete", group: "Marketing", label: "Delete Popup", description: "Delete a popup" },

  // ── Vouchers ──────────────────────────────────────────────────────────────
  { key: "vouchers.view", group: "Vouchers", label: "View Vouchers", description: "View voucher list" },
  { key: "vouchers.create", group: "Vouchers", label: "Create Voucher", description: "Issue any voucher type" },
  { key: "vouchers.edit", group: "Vouchers", label: "Edit Voucher", description: "Edit a voucher" },
  { key: "vouchers.delete", group: "Vouchers", label: "Delete Voucher", description: "Delete a voucher" },
  { key: "vouchers.limit", group: "Vouchers", label: "Manage Limit Vouchers", description: "Issue/manage limit (credit) vouchers" },
  { key: "vouchers.deposit", group: "Vouchers", label: "Manage Deposit Vouchers", description: "Issue/manage deposit vouchers" },
  { key: "vouchers.withdraw", group: "Vouchers", label: "Manage Withdraw Vouchers", description: "Issue/manage withdraw vouchers" },

  // ── Notifications ─────────────────────────────────────────────────────────
  { key: "notifications.view", group: "Notifications", label: "View Notifications", description: "View system notifications" },
  { key: "notifications.create", group: "Notifications", label: "Create Notification", description: "Send a system notification" },
  { key: "notifications.edit", group: "Notifications", label: "Edit Notification", description: "Edit a notification" },
  { key: "notifications.delete", group: "Notifications", label: "Delete Notification", description: "Delete a notification" },

  // ── KYC ───────────────────────────────────────────────────────────────────
  { key: "kyc.view", group: "KYC", label: "View KYC", description: "View KYC documents and submissions" },
  { key: "kyc.approve", group: "KYC", label: "Approve KYC", description: "Approve KYC submissions" },
  { key: "kyc.reject", group: "KYC", label: "Reject KYC", description: "Reject KYC submissions" },

  // ── Currency ──────────────────────────────────────────────────────────────
  { key: "currency.view", group: "Currency", label: "View Currencies", description: "View currency list and rates" },
  { key: "currency.create", group: "Currency", label: "Create Currency", description: "Add a currency" },
  { key: "currency.edit", group: "Currency", label: "Edit Currency", description: "Edit a currency" },
  { key: "currency.delete", group: "Currency", label: "Delete Currency", description: "Delete a currency" },
  { key: "currency.set_rates", group: "Currency", label: "Set Exchange Rates", description: "Adjust currency exchange rates" },

  // ── Whitelabels ───────────────────────────────────────────────────────────
  { key: "whitelabels.view", group: "Whitelabels", label: "View Whitelabels", description: "View whitelabel list" },
  { key: "whitelabels.create", group: "Whitelabels", label: "Create Whitelabel", description: "Create a whitelabel" },
  { key: "whitelabels.edit", group: "Whitelabels", label: "Edit Whitelabel", description: "Edit whitelabel config" },
  { key: "whitelabels.delete", group: "Whitelabels", label: "Delete Whitelabel", description: "Delete a whitelabel" },
  { key: "whitelabels.assign_admin", group: "Whitelabels", label: "Assign Admin", description: "Assign/change a whitelabel admin" },

  // ── Withdrawal Methods ────────────────────────────────────────────────────
  { key: "withdrawal_methods.view", group: "Withdrawal Methods", label: "View Methods", description: "View withdrawal methods" },
  { key: "withdrawal_methods.create", group: "Withdrawal Methods", label: "Create Method", description: "Add a withdrawal method" },
  { key: "withdrawal_methods.edit", group: "Withdrawal Methods", label: "Edit Method", description: "Edit a withdrawal method" },
  { key: "withdrawal_methods.delete", group: "Withdrawal Methods", label: "Delete Method", description: "Delete a withdrawal method" },

  // ── QR Codes ──────────────────────────────────────────────────────────────
  { key: "qrcodes.view", group: "QR Codes", label: "View QR Codes", description: "View QR codes" },
  { key: "qrcodes.create", group: "QR Codes", label: "Create QR Code", description: "Add a QR code" },
  { key: "qrcodes.edit", group: "QR Codes", label: "Edit QR Code", description: "Edit a QR code" },
  { key: "qrcodes.delete", group: "QR Codes", label: "Delete QR Code", description: "Delete a QR code" },

  // ── Settings ──────────────────────────────────────────────────────────────
  { key: "settings.view", group: "Settings", label: "View Settings", description: "View global settings" },
  { key: "settings.edit_global", group: "Settings", label: "Edit Global Settings", description: "Edit site name, logo, theme" },
  { key: "settings.maintenance_mode", group: "Settings", label: "Toggle Maintenance Mode", description: "Enable/disable maintenance mode" },

  // ── Domains ───────────────────────────────────────────────────────────────
  { key: "domains.view", group: "Domains", label: "View Domains", description: "View whitelabel domains" },
  { key: "domains.add", group: "Domains", label: "Add Domain", description: "Register a new domain" },
  { key: "domains.delete", group: "Domains", label: "Delete Domain", description: "Remove a domain" },

  // ── Staff Management (meta) ───────────────────────────────────────────────
  { key: "staff.view", group: "Staff Management", label: "View Staff", description: "View staff member list and assignments" },
  { key: "staff.assign_role", group: "Staff Management", label: "Assign Staff Role", description: "Assign a staff role to a user" },
  { key: "staff.manage_overrides", group: "Staff Management", label: "Manage Permission Overrides", description: "Grant/deny individual permissions per user" },
  { key: "staff_roles.view", group: "Staff Management", label: "View Staff Roles", description: "View role templates" },
  { key: "staff_roles.create", group: "Staff Management", label: "Create Staff Role", description: "Create a new role template" },
  { key: "staff_roles.edit", group: "Staff Management", label: "Edit Staff Role", description: "Edit role template & its permissions" },
  { key: "staff_roles.delete", group: "Staff Management", label: "Delete Staff Role", description: "Delete a non-system role template" },
];

/** Set of every key, for O(1) validation. */
export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

/** Quick lookup by key. */
export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map((p) => [p.key, p]),
);

/** Group definitions in display order (for the staff-roles UI). */
export const PERMISSION_GROUPS_ORDERED: PermissionGroup[] = [
  "Dashboard",
  "Users",
  "Account Statement",
  "Sports",
  "Sports Result",
  "Live Markets",
  "Transaction Management",
  "Live Prediction",
  "Custom Markets",
  "Matka",
  "Jambo",
  "Bombay Bazar",
  "Home Sections",
  "Marketing",
  "Vouchers",
  "Notifications",
  "KYC",
  "Currency",
  "Whitelabels",
  "Withdrawal Methods",
  "QR Codes",
  "Settings",
  "Domains",
  "Staff Management",
];

/** Returns all non-deprecated keys grouped by their group, preserving order. */
export function getPermissionsByGroup(): Record<PermissionGroup, PermissionDefinition[]> {
  const out = {} as Record<PermissionGroup, PermissionDefinition[]>;
  for (const g of PERMISSION_GROUPS_ORDERED) out[g] = [];
  for (const p of PERMISSIONS) {
    if (p.deprecated) continue;
    out[p.group].push(p);
  }
  return out;
}
