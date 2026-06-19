import {
  pgTable,
  varchar,
  text,
  timestamp,
  boolean,
  date,
  decimal,
  integer,
  bigint,
  jsonb,
  pgEnum,
  uuid,
  serial,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { RecordStatus, BetType, UserRole, MembershipType, VoucherType, VoucherStatus, DrCr, MarketType } from "../types/enums";

/** Fixed UUID for the "system" user — used as default for all audit columns. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export const whitelabelTypeEnum = pgEnum("whitelabel_type", ["B2B", "B2C"]);

// ── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: integer("role").default(UserRole.User).notNull(),
  groupId: integer("group_id"),
  whitelabelId: uuid("whitelabel_id"),
  accountStatus: boolean("account_status").default(true).notNull(),
  parentAccountStatus: boolean("parent_account_status").default(true).notNull(),
  emailVerified: boolean("email_verified").default(false),
  sessionToken: varchar("session_token", { length: 36 }),
  createdBy: uuid("created_by"),
  /**
   * Staff delegation columns.
   *
   * A "staff" user is a delegated proxy of a tier user (Owner/Admin/Super/Master/Agent):
   *   - is_staff = true marks them as such.
   *   - parent_user_id points to the tier user they work under.
   *   - role mirrors the parent's role so existing data-scoping logic works
   *     (e.g. an Admin's staff has role=Admin) — they're then swapped to the
   *     parent's identity inside resolveOwnerScope for queries.
   *   - Permissions are entirely controlled by user_staff_role + overrides;
   *     Owner-bypass in getEffectivePermissions does NOT apply to staff users
   *     (so an Owner's staff has only the permissions the Owner grants).
   */
  parentUserId: uuid("parent_user_id"),
  isStaff: boolean("is_staff").default(false).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── OTPs ─────────────────────────────────────────────────────────────────────
export const otps = pgTable("otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  type: varchar("type", { length: 20 }).default("email_verification"),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Promotions ───────────────────────────────────────────────────────────────
export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(),
  imageUrl: text("image_url"),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Promo Codes ──────────────────────────────────────────────────────────────
export const promocodes = pgTable("promocodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  type: varchar("type", { length: 50 }).notNull(),
  value: varchar("value", { length: 100 }).notNull(),
  usageLimit: integer("usage_limit").default(1),
  usedCount: integer("used_count").default(0),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Banners ──────────────────────────────────────────────────────────────────
export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  imageUrl: text("image_url").notNull(),
  linkUrl: text("link_url"),
  position: varchar("position", { length: 50 }).default("home"),
  order: integer("order").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Popups ───────────────────────────────────────────────────────────────────
export const popups = pgTable("popups", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  imageUrl: text("image_url").notNull(),
  targetPage: varchar("target_page", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Whitelabels ──────────────────────────────────────────────────────────────
export const whitelabels = pgTable("whitelabels", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  whitelabelType: whitelabelTypeEnum("whitelabel_type").notNull().default("B2C"),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 255 }),
  description: text("description"),
  logo: text("logo"),
  favicon: text("favicon"),
  contactEmail: varchar("contact_email", { length: 255 }),
  socialLinks: text("social_links"),
  status: varchar("status", { length: 20 }).default("active"),
  theme: text("theme").default(
    JSON.stringify({
      primary: "#ffd85c",
      primaryForeground: "#1b1300",
      secondary: "#5b2e8a",
      secondaryForeground: "#f4e2c8",
      accent: "#ffbf4d",
      accentForeground: "#1c1400",
      card: "#221233",
      cardForeground: "#f4e2c8",
      muted: "#3a275e",
      mutedForeground: "#d9c8b3",
      border: "#3f2a60",
      input: "#6943a1",
      ring: "#ffd85c",
      foreground: "#fff8ec",
      success: "#5fc24d",
      error: "#e85854",
      info: "#009ed4",
      background: "#120a1c",
    })
  ),
  layout: text("layout").default(
    JSON.stringify({
      sidebarType: "sidebar-1",
      bannerType: "banner-1",
    })
  ),
  config: text("config").default(
    JSON.stringify({
      dbName: "casino_main",
      s3FolderName: "casino-assets",
    })
  ),
  preferences: text("preferences").default(
    JSON.stringify({
      language: "en",
      currency: "INR",
      timezone: "UTC",
      dateFormat: "MM/DD/YYYY",
      enableLiveChat: true,
      enableNotifications: true,
      maintenanceMode: false,
    })
  ),
  permissions: text("permissions").default(
    JSON.stringify({
      casino: true,
      sports: true,
      liveCasino: true,
      promotions: true,
      vouchers: true,
      userManagement: false,
      reports: false,
      settings: false,
    })
  ),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Vouchers ─────────────────────────────────────────────────────────────────
export const vouchers = pgTable("vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  type: integer("type").notNull(), // VoucherType enum: 0=credit,1=debit,2=limit,3=deposit,4=withdraw,5=bonus,6=settlement
  status: integer("status").default(VoucherStatus.Pending).notNull(), // VoucherStatus enum: 0=pending,1=approved,2=rejected
  method: varchar("method", { length: 50 }),
  reference: varchar("reference", { length: 255 }),
  remarks: varchar("remarks", { length: 200 }),
  remarks1: varchar("remarks1", { length: 200 }),
  remarks2: varchar("remarks2", { length: 200 }),
  remarks3: varchar("remarks3", { length: 200 }),
  eventTypeId: bigint("event_type_id", { mode: "number" }),
  competitionId: bigint("competition_id", { mode: "number" }),
  eventId: bigint("event_id", { mode: "number" }),
  marketId: numeric("market_id"),
  approvedBy: uuid("approved_by"),
  approvedDate: date("approved_date"),
  shiftId: uuid("shift_id").default("00000000-0000-0000-0000-000000000000"),
  voucherDate: date("voucher_date").defaultNow().notNull(),
  // ── Audit ──
  addedBy: uuid("added_by"),
  addedDate: timestamp("added_date", { withTimezone: true }).defaultNow().notNull(),
  updateBy: uuid("update_by"),
  updateDate: timestamp("update_date", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Voucher Details ──────────────────────────────────────────────────────────
export const voucherDetails = pgTable("voucher_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  voucherId: uuid("voucher_id")
    .references(() => vouchers.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  oppositeUserId: uuid("opposite_user_id"), // the other party's user id
  role: integer("role"), // UserRole enum: 0=owner,3=admin,4=super,5=master,6=agent,7=user
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  voucherType: integer("voucher_type"), // VoucherType enum: same as voucher.type
  voucherDetailType: integer("voucher_detail_type"), // VoucherType enum: same as voucher.type
  drCr: integer("dr_cr"), // DrCr enum: 0=debit,1=credit
  parentVoucherDetailId: uuid("parent_voucher_detail_id"),
  mondayFinal: boolean("monday_final").default(false),
  remarks: varchar("remarks", { length: 200 }),
  remarks1: varchar("remarks1", { length: 200 }),
  remarks2: varchar("remarks2", { length: 200 }),
  remarks3: varchar("remarks3", { length: 200 }),
  proofImage: text("proof_image"),
  transactionId: uuid("transaction_id"),
  referenceId: varchar("reference_id", { length: 255 }),
  isProcessed: boolean("is_processed").default(false).notNull(),
  description: varchar("description", { length: 255 }),
  whitelabelId: uuid("whitelabel_id"),
  shiftId: uuid("shift_id").default("00000000-0000-0000-0000-000000000000"),
  voucherDate: date("voucher_date").defaultNow().notNull(),
  // ── Audit ──
  addedBy: uuid("added_by"),
  addedDate: timestamp("added_date", { withTimezone: true }).defaultNow().notNull(),
  updateBy: uuid("update_by"),
  updateDate: timestamp("update_date", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── KYC Documents ────────────────────────────────────────────────────────────
export const kycDocuments = pgTable("kyc_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  documentUrl: text("document_url").notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  reviewNotes: text("review_notes"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Profiles ─────────────────────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  birthDate: date("birth_date"),
  phone: varchar("phone", { length: 20 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  address: text("address"),
  withdrawalAddress: text("withdrawal_address"),
  avatar: text("avatar"),
  membership: integer("membership").default(MembershipType.Bronze).notNull(),
  betStatus: boolean("bet_status").default(true).notNull(),
  parentBetStatus: boolean("parent_bet_status").default(true).notNull(),
  upline: decimal("upline", { precision: 5, scale: 2 }).default("0.00"),
  downline: decimal("downline", { precision: 5, scale: 2 }).default("0.00"),
  currencyId: uuid("currency_id"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  lastLoginAt: timestamp("last_login_at"),
  stakeSettings: jsonb("stake_settings"), // Array of { label: string, value: number }
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Settings ─────────────────────────────────────────────────────────────────
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteName: varchar("site_name", { length: 255 }).default("AIEXCH"),
  logo: text("logo"),
  favicon: text("favicon"),
  authImage: text("auth_image"),
  theme: text("theme").default(
    JSON.stringify({
      background: "#120a1c",
      foreground: "#fff8ec",
      card: "#221233",
      cardForeground: "#f4e2c8",
      primary: "#ffd85c",
      primaryForeground: "#1b1300",
      secondary: "#5b2e8a",
      secondaryForeground: "#f4e2c8",
      muted: "#3a275e",
      mutedForeground: "#d9c8b3",
      accent: "#ffbf4d",
      accentForeground: "#1c1400",
      border: "#3f2a60",
      input: "#6943a1",
      ring: "#ffd85c",
      popover: "#221233",
      popoverForeground: "#f4e2c8",
      success: "#5fc24d",
      error: "#e85854",
      info: "#009ed4",
      sidebar: "#120a1c",
      sidebarForeground: "#f4e2c8",
      sidebarPrimary: "#ffd85c",
      sidebarPrimaryForeground: "#1b1300",
      sidebarAccent: "#ffbf4d",
      sidebarAccentForeground: "#1c1400",
      sidebarBorder: "#3f2a60",
      sidebarRing: "#ffd85c",
    })
  ),
  maintenanceMode: boolean("maintenance_mode").default(false),
  maintenanceMessage: text("maintenance_message").default(
    "We are currently performing scheduled maintenance. Please check back soon."
  ),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Ledger Groups ────────────────────────────────────────────────────────────
export const ledgerGroups = pgTable("ledger_groups", {
  ledgerGroupsid: serial("ledger_group_id").primaryKey().notNull(),
  ledgerGroupsname: varchar("ledger_group_name", { length: 100 }).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).default("info"),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── User Read Notifications ──────────────────────────────────────────────────
export const userReadNotifications = pgTable("user_read_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  notificationId: uuid("notification_id")
    .references(() => notifications.id, { onDelete: "cascade" })
    .notNull(),
  isRead: boolean("is_read").default(true),
  readAt: timestamp("read_at").defaultNow(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── QR Codes ─────────────────────────────────────────────────────────────────
export const qrCodes = pgTable("qr_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentMethod: varchar("payment_method", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("INR"),
  qrCodeUrl: text("qr_code_url"),
  walletAddress: text("wallet_address"),
  instructions: text("instructions"),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transactions (Bets) ─────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  whitelabelId: uuid("whitelabel_id"),
  eventTypeId: bigint("event_type_id", { mode: "number" }).notNull(),
  competitionId: bigint("competition_id", { mode: "number" }),
  matchId: bigint("match_id", { mode: "number" }).notNull(),
  marketId: numeric("market_id").notNull(),
  marketName: varchar("market_name", { length: 255 }),
  marketType: integer("market_type").default(MarketType.MatchOdds).notNull(), // MarketType enum: 0=match_odds,1=tied_match,2=complete_match,3=bookmaker,4=fancy
  selectionId: bigint("selection_id", { mode: "number" }).notNull(),
  selectionName: varchar("selection_name", { length: 255 }),
  betType: integer("bet_type").notNull(), // 0=back, 1=lay (BetType enum)
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  odds: decimal("odds", { precision: 10, scale: 4 }).notNull(),
  status: varchar("status", { length: 20 }).default("matched"), // matched | won | lost | cancelled | void
  settledAmount: decimal("settled_amount", { precision: 15, scale: 2 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  matchedAt: timestamp("matched_at"),
  settledAt: timestamp("settled_at"),
  cancelledAt: timestamp("cancelled_at"),
  resultCheckedAt: timestamp("result_checked_at"),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Details ──────────────────────────────────────────────────────
export const transactionDetails = pgTable("transaction_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .references(() => transactions.id, { onDelete: "cascade" })
    .notNull(),
  runnerId: bigint("runner_id", { mode: "number" }).notNull(),
  runnerName: varchar("runner_name", { length: 255 }),
  isUserSelection: boolean("is_user_selection").default(false).notNull(),
  betType: integer("bet_type"), // 0=back, 1=lay (BetType enum)
  basePrice: decimal("base_price", { precision: 10, scale: 4 }).notNull(),
  price: decimal("price", { precision: 10, scale: 4 }).notNull(),
  run: integer("run").default(0),
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  potentialReturn: decimal("potential_return", { precision: 15, scale: 2 }).notNull(),
  // Reason captured when a transaction is soft-deleted from Transaction Management.
  remark: varchar("remark", { length: 500 }),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Sports Games ─────────────────────────────────────────────────────────────
export const sportsGames = pgTable("sports_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  imageUrl: text("image_url"),
  linkPath: varchar("link_path", { length: 255 }),
  marketCount: integer("market_count").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Casino Games (Ace Gamings catalog mirror) ────────────────────────────────
// Synced periodically from GET /games on the Ace Gamings Platform.
// `externalId` is Ace's numeric `id` (treated as opaque, non-sequential).
// Real bet/wallet flow uses casino_transactions (added in a later migration).
export const casinoGames = pgTable("casino_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: integer("external_id").notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  lang: varchar("lang", { length: 10 }).default("en-US").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  specialNote: varchar("special_note", { length: 50 }),
  // Operator-controlled visibility. Sync sets this to true on new games; admin
  // can hide individual games from the lobby without dropping the row.
  visible: boolean("visible").default(true).notNull(),
  // When the upstream catalog last reported this game. Older rows can be
  // hidden if no longer in the feed.
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Casino Bets ──────────────────────────────────────────────────────────────
// One row per bet placed via any casino provider (Ace or QTech). Mirrors the
// sports `transactions` table in shape and intent — this is the single source
// of truth for "what bets did the user place." Wallet-callback details (full
// raw payloads from Ace's exposure/settlement/rollback) are no longer kept;
// `rawPayload` here stores the original bet object so disputes can still
// reconstruct what the provider sent.
export const casinoTransactions = pgTable("casino_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  // Snapshot from users.whitelabel_id at placement time, mirroring sports.
  whitelabelId: uuid("whitelabel_id"),
  // 'ace' | 'qtech' — disambiguates the providerBetId/roundId namespace.
  provider: varchar("provider", { length: 20 }).notNull(),
  // Ace's numeric bet id or QTech's betId/txnId. Unique within a provider.
  providerBetId: varchar("provider_bet_id", { length: 100 }).notNull(),
  providerRoundId: varchar("provider_round_id", { length: 100 }),
  // Ace's request_id / QTech's txnId — ties bets placed in the same callback.
  providerTransactionId: varchar("provider_transaction_id", { length: 100 }),
  gameId: varchar("game_id", { length: 100 }),
  gameName: varchar("game_name", { length: 100 }),
  // Ace-only: bet shape details. NULL for QTech (they don't surface them).
  selectionId: varchar("selection_id", { length: 100 }),
  selectionName: varchar("selection_name", { length: 255 }),
  betType: varchar("bet_type", { length: 10 }), // BACK | LAY
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  odds: decimal("odds", { precision: 10, scale: 4 }),
  // Per-bet worst-case liability (Ace's per-bet `exposure`). Used by
  // casino_declare_round for payout. NOT used for the limit hold — see below.
  exposure: decimal("exposure", { precision: 15, scale: 2 }),
  // NET worst-case liability for the WHOLE round, as computed by Ace knowing
  // the full outcome set and pushed as the top-level `exposure` on every
  // /accounts/exposure call (a running TOTAL, already netting BACK against LAY
  // across selections). This is the casino analog of sports knowing its full
  // runner set: we can't re-derive it from the user's own bets alone (we never
  // see the unbacked selections), so we store Ace's authoritative number and
  // the limit holds it per round. Same value on every matched row of a round;
  // fn_casino_round_exposure takes MAX per round. NULL for QTech / legacy rows,
  // which fall back to the per-bet stake sum.
  roundExposure: decimal("round_exposure", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  // matched | won | lost | cancelled | void | rolled_back
  status: varchar("status", { length: 20 }).default("matched").notNull(),
  // Per-bet P/L from the provider's settlement payload (positive = won,
  // negative = lost). For display in the user's bet history.
  settledAmount: decimal("settled_amount", { precision: 15, scale: 2 }),
  // Total amount credited back to user on settlement:
  //   WON       → stake + winnings
  //   LOST      → 0
  //   VOID/CANCEL → stake (refund)
  payout: decimal("payout", { precision: 15, scale: 2 }),
  // Provider's raw outcome string for the bet (WON | LOST | VOIDED |
  // CANCELLED | DELETED) — kept verbatim for the bet-history label.
  outcome: varchar("outcome", { length: 20 }),
  // SYSTEM_USER_ID for provider callbacks, or an admin id for manual
  // overrides (when result handling is exposed in the panel later).
  settledBy: uuid("settled_by"),
  ipAddress: varchar("ip_address", { length: 45 }),
  placedAt: timestamp("placed_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  // Original bet object from the provider — preserved for audit / disputes.
  rawPayload: jsonb("raw_payload"),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("casino_transactions_provider_bet_uniq").on(table.provider, table.providerBetId),
]);

// ── Casino Transaction Logs ──────────────────────────────────────────────────
// Mirrors transaction_logs for sports. One row per casino bet placement,
// carrying the device / network metadata available at that moment.
//
// For Ace: ipAddress comes from the bet payload (`bet.ip`). userAgent and the
// derived browser/os/device fields are NULL because Ace callbacks originate
// from their server, not the player's browser.
// For QTech: most fields are NULL — QTech sends no device info on callbacks.
export const casinoTransactionLogs = pgTable("casino_transaction_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  casinoBetId: uuid("casino_bet_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Casino Settlements ───────────────────────────────────────────────────────
// One row per settlement / rollback callback received from a provider. Used
// for idempotency (unique on provider + provider_transaction_id) and for
// keeping the raw payload around for dispute resolution. The per-bet result
// data lives on casino_transactions — this table is the wallet-callback audit log.
export const casinoSettlements = pgTable("casino_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 20 }).notNull(),
  // Ace's settlement transaction_id or QT's CREDIT txnId.
  providerTransactionId: varchar("provider_transaction_id", { length: 100 }).notNull(),
  providerRoundId: varchar("provider_round_id", { length: 100 }),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  // Total per-player P/L from this callback (sum of bets[].pl).
  totalPl: decimal("total_pl", { precision: 15, scale: 2 }),
  // Total exposure released — Ace's exposure model carries this; null for QT.
  totalExposureReleased: decimal("total_exposure_released", { precision: 15, scale: 2 }),
  // Full callback payload — jsonb for replay / disputes.
  rawPayload: jsonb("raw_payload"),
  // applied | failed
  status: varchar("status", { length: 20 }).default("applied").notNull(),
  // ── Audit ──
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("casino_settlements_provider_txn_uniq").on(table.provider, table.providerTransactionId),
]);

// ── Casino Transaction Commissions ───────────────────────────────────────────
// Mirrors transaction_commissions for sports. Hierarchy snapshot computed at
// placement time using the same recursive `users.added_by` walk + downline%
// rule as sports bets, so commission reports work identically.
export const casinoTransactionCommissions = pgTable("casino_transaction_commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  casinoBetId: uuid("casino_bet_id").notNull(),
  agentId: uuid("agent_id"),
  agentPercent: decimal("agent_percent", { precision: 5, scale: 2 }).default("0"),
  masterId: uuid("master_id"),
  masterPercent: decimal("master_percent", { precision: 5, scale: 2 }).default("0"),
  superId: uuid("super_id"),
  superPercent: decimal("super_percent", { precision: 5, scale: 2 }).default("0"),
  adminId: uuid("admin_id"),
  adminPercent: decimal("admin_percent", { precision: 5, scale: 2 }).default("0"),
  ownerId: uuid("owner_id"),
  ownerPercent: decimal("owner_percent", { precision: 5, scale: 2 }).default("0"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Home Sections ────────────────────────────────────────────────────────────
export const homeSections = pgTable("home_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 255 }),
  type: varchar("type", { length: 50 }).notNull().default("games"),
  order: integer("order").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Home Section Games ───────────────────────────────────────────────────────
export const homeSectionGames = pgTable("home_section_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id")
    .references(() => homeSections.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  image: text("image").notNull(),
  link: varchar("link", { length: 255 }).notNull(),
  popular: boolean("popular").default(false),
  hot: boolean("hot").default(false),
  order: integer("order").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Withdrawal Methods ───────────────────────────────────────────────────────
export const withdrawalMethods = pgTable("withdrawal_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("INR"),
  minAmount: varchar("min_amount", { length: 50 }).default("100"),
  maxAmount: varchar("max_amount", { length: 50 }).default("100000"),
  processingTime: varchar("processing_time", { length: 100 }).default("1-3 business days"),
  feePercentage: varchar("fee_percentage", { length: 10 }).default("0"),
  feeFixed: varchar("fee_fixed", { length: 50 }).default("0"),
  instructions: text("instructions"),
  status: varchar("status", { length: 20 }).default("active"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Sports ───────────────────────────────────────────────────────────────────
export const sports = pgTable("sports", {
  id: uuid("id").primaryKey().defaultRandom(),
  sport_id: bigint("sport_id", { mode: "number" }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  is_active: boolean("is_active").default(true),
  // When false, the sport is shown in the sidebar/dropheader but its page
  // displays a "Coming Soon" banner instead of live content.
  is_live: boolean("is_live").default(true).notNull(),
  // When true, the sport renders with the highlighted "pinned" shimmer
  // treatment in the drop-header (same look as owner-pinned events).
  is_highlight: boolean("is_highlight").default(false).notNull(),
  sort_order: integer("sort_order").default(0),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Competitions ─────────────────────────────────────────────────────────────
export const competitions = pgTable("competitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  competition_id: bigint("competition_id", { mode: "number" }).notNull().unique(),
  sport_id: bigint("sport_id", { mode: "number" }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  provider: varchar("provider", { length: 50 }),
  is_active: boolean("is_active").default(false),
  is_top_competition: boolean("is_top_competition").default(false).notNull(),
  is_archived: boolean("is_archived").default(false),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Competition Whitelabel Overrides ─────────────────────────────────────────
// Per-whitelabel visibility override for competitions.
// When a row exists with is_active=false, that competition is hidden for that whitelabel.
export const competitionWhitelabelOverrides = pgTable("competition_whitelabel_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull(),
  whitelabelId: uuid("whitelabel_id").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("uq_competition_whitelabel").on(table.competitionId, table.whitelabelId),
]);

// ── Currencies ───────────────────────────────────────────────────────────────
export const currencies = pgTable("currencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  countryName: varchar("country_name", { length: 100 }).notNull(),
  value: decimal("value", { precision: 18, scale: 6 }).notNull().default("1"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Currency Value History ───────────────────────────────────────────────────
export const currencyValueHistory = pgTable("currency_value_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  currencyId: uuid("currency_id")
    .references(() => currencies.id, { onDelete: "cascade" })
    .notNull(),
  value: decimal("value", { precision: 18, scale: 6 }).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── User Login Logs ──────────────────────────────────────────────────────────
export const userLoginLogs = pgTable("user_login_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  status: varchar("status", { length: 20 }).default("success"),
  failureReason: varchar("failure_reason", { length: 255 }),
  loginAt: timestamp("login_at").defaultNow(),
  logoutAt: timestamp("logout_at"),
  sessionDurationSeconds: integer("session_duration_seconds"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Logs ─────────────────────────────────────────────────────────
export const transactionLogs = pgTable("transaction_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Ledger Limit ─────────────────────────────────────────────────────────────
export const ledgerLimit = pgTable("ledger_limit", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  userBalance: decimal("user_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  userLimit: decimal("user_limit", { precision: 15, scale: 2 }).default("0").notNull(),
  limitConsumed: decimal("limit_consumed", { precision: 15, scale: 2 }).default("0").notNull(),
  fixLimit: decimal("fix_limit", { precision: 15, scale: 2 }).default("0").notNull(),
  finalLimit: decimal("final_limit", { precision: 15, scale: 2 }).default("0").notNull(),
  // Per-user maximum stake for a single bet. 0 means "no per-bet cap";
  // any other value caps each individual bet at that amount (multiple bets
  // are still allowed).
  transactionLimit: decimal("transaction_limit", { precision: 15, scale: 2 }).default("0").notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Events (matches) ─────────────────────────────────────────────────────────
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: bigint("event_id", { mode: "number" }).notNull().unique(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull(),
  sportId: bigint("sport_id", { mode: "number" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  openDate: timestamp("open_date"),
  whitelabelId: uuid("whitelabel_id"),
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),
  isRecommended: boolean("is_recommended").default(false).notNull(),
  // Owner-pinned events surface in the site's top "drop header" nav under a
  // custom label the owner types when pinning. `pinLabel` is that label and is
  // null when the event isn't pinned. Pinning respects per-whitelabel disables
  // (a whitelabel that turned the event off won't see the pinned entry).
  isPinned: boolean("is_pinned").default(false).notNull(),
  pinLabel: varchar("pin_label", { length: 120 }),
  suspended: boolean("suspended").default(false).notNull(),
  betDelay: integer("bet_delay").default(0).notNull(),
  maxMarketProfit: decimal("max_market_profit", { precision: 15, scale: 2 }),
  defaultMarketId: varchar("default_market_id", { length: 50 }),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Declared Events ─────────────────────────────────────────────────────────
// Archive table mirroring `events`. Once an event is declared/settled and is
// no longer relevant to the live `events` table, the row is moved here. Same
// shape as `events` so callers can swap reads with minimal changes.
export const declaredEvents = pgTable("declared_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: bigint("event_id", { mode: "number" }).notNull().unique(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull(),
  sportId: bigint("sport_id", { mode: "number" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  openDate: timestamp("open_date"),
  whitelabelId: uuid("whitelabel_id"),
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),
  isRecommended: boolean("is_recommended").default(false).notNull(),
  suspended: boolean("suspended").default(false).notNull(),
  betDelay: integer("bet_delay").default(0).notNull(),
  maxMarketProfit: decimal("max_market_profit", { precision: 15, scale: 2 }),
  defaultMarketId: varchar("default_market_id", { length: 50 }),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Event Whitelabel Overrides ──────────────────────────────────────────────
// Per-whitelabel visibility override for events (matches).
export const eventWhitelabelOverrides = pgTable("event_whitelabel_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  whitelabelId: uuid("whitelabel_id").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("uq_event_whitelabel").on(table.eventId, table.whitelabelId),
]);

// ── Market Settings ──────────────────────────────────────────────────────────
export const marketSettings = pgTable("market_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: numeric("market_id").notNull().unique(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  marketName: varchar("market_name", { length: 255 }).notNull(),
  marketType: varchar("market_type", { length: 50 }).notNull(),
  bettingType: integer("betting_type").default(MarketType.MatchOdds).notNull(),
  provider: varchar("provider", { length: 50 }).default("API"),
  whitelabelId: uuid("whitelabel_id"),
  isCustom: boolean("is_custom").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),
  suspended: boolean("suspended").default(false).notNull(),
  betLock: boolean("bet_lock").default(false).notNull(),
  betDelay: integer("bet_delay"),
  minBet: decimal("min_bet", { precision: 15, scale: 2 }),
  maxBet: decimal("max_bet", { precision: 15, scale: 2 }),
  maxProfit: decimal("max_profit", { precision: 15, scale: 2 }),
  sortPriority: integer("sort_priority").default(0),
  // Owner/staff-authored notice shown on the public match page for this market.
  notice: varchar("notice", { length: 500 }),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Runner Settings ──────────────────────────────────────────────────────────
export const runnerSettings = pgTable("runner_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  selectionId: bigint("selection_id", { mode: "number" }).notNull(),
  marketId: numeric("market_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  sortPriority: integer("sort_priority").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Custom Market Odds ───────────────────────────────────────────────────────
export const customMarketOdds = pgTable("custom_market_odds", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: numeric("market_id").notNull(),
  selectionId: bigint("selection_id", { mode: "number" }).notNull(),
  backPrices: jsonb("back_prices").$type<{ price: number; size: number }[]>().default([]),
  layPrices: jsonb("lay_prices").$type<{ price: number; size: number }[]>().default([]),
  line: decimal("line", { precision: 10, scale: 2 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Market Odds History ──────────────────────────────────────────────────────
export const marketOddsHistory = pgTable("market_odds_history", {
  id: serial("id").primaryKey(),
  marketId: numeric("market_id").notNull(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  capturedAt: timestamp("captured_at").notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Commissions ──────────────────────────────────────────────────
export const transactionCommissions = pgTable("transaction_commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  agentId: uuid("agent_id"),
  agentPercent: decimal("agent_percent", { precision: 5, scale: 2 }).default("0"),
  masterId: uuid("master_id"),
  masterPercent: decimal("master_percent", { precision: 5, scale: 2 }).default("0"),
  superId: uuid("super_id"),
  superPercent: decimal("super_percent", { precision: 5, scale: 2 }).default("0"),
  adminId: uuid("admin_id"),
  adminPercent: decimal("admin_percent", { precision: 5, scale: 2 }).default("0"),
  ownerId: uuid("owner_id"),
  ownerPercent: decimal("owner_percent", { precision: 5, scale: 2 }).default("0"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transactions Declare (archive after result declared) ─────────────────────
export const transactionsDeclare = pgTable("transactions_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  whitelabelId: uuid("whitelabel_id"),
  eventTypeId: bigint("event_type_id", { mode: "number" }).notNull(),
  competitionId: bigint("competition_id", { mode: "number" }),
  matchId: bigint("match_id", { mode: "number" }).notNull(),
  marketId: numeric("market_id").notNull(),
  marketName: varchar("market_name", { length: 255 }),
  marketType: integer("market_type").default(0).notNull(),
  selectionId: bigint("selection_id", { mode: "number" }).notNull(),
  selectionName: varchar("selection_name", { length: 255 }),
  betType: integer("bet_type").notNull(),
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  odds: decimal("odds", { precision: 10, scale: 4 }).notNull(),
  status: varchar("status", { length: 20 }).default("matched"),
  settledAmount: decimal("settled_amount", { precision: 15, scale: 2 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  matchedAt: timestamp("matched_at"),
  settledAt: timestamp("settled_at"),
  cancelledAt: timestamp("cancelled_at"),
  resultCheckedAt: timestamp("result_checked_at"),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Details Declare (archive after result declared) ───────────────
export const transactionDetailsDeclare = pgTable("transaction_details_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  runnerId: bigint("runner_id", { mode: "number" }).notNull(),
  runnerName: varchar("runner_name", { length: 255 }),
  isUserSelection: boolean("is_user_selection").default(false).notNull(),
  betType: integer("bet_type"),
  basePrice: decimal("base_price", { precision: 10, scale: 4 }).notNull(),
  price: decimal("price", { precision: 10, scale: 4 }).notNull(),
  run: integer("run").default(0),
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  potentialReturn: decimal("potential_return", { precision: 15, scale: 2 }).notNull(),
  // Reason captured when a transaction is soft-deleted from Transaction Management.
  remark: varchar("remark", { length: 500 }),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Commissions Declare (archive after result declared) ───────────
export const transactionCommissionsDeclare = pgTable("transaction_commissions_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  agentId: uuid("agent_id"),
  agentPercent: decimal("agent_percent", { precision: 5, scale: 2 }).default("0"),
  masterId: uuid("master_id"),
  masterPercent: decimal("master_percent", { precision: 5, scale: 2 }).default("0"),
  superId: uuid("super_id"),
  superPercent: decimal("super_percent", { precision: 5, scale: 2 }).default("0"),
  adminId: uuid("admin_id"),
  adminPercent: decimal("admin_percent", { precision: 5, scale: 2 }).default("0"),
  ownerId: uuid("owner_id"),
  ownerPercent: decimal("owner_percent", { precision: 5, scale: 2 }).default("0"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Logs Declare (archive after result declared) ──────────────────
export const transactionLogsDeclare = pgTable("transaction_logs_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Shifts ────────────────────────────────────────────────────────────
// `sport_type` differentiates shift families that share this table:
//   1001 = Matka (numbers 1-100), 1004 = Jambo (numbers 1-1000),
//   1005 = Bombay Bazar (declares twice a day → closing_time + sangam/pana rates).
export const matkaShifts = pgTable("matka_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  sportType: integer("sport_type").default(1001).notNull(),
  shiftDate: date("shift_date").notNull(),
  endTime: varchar("end_time", { length: 30 }).notNull(),        // e.g. "14:00"
  shiftOrder: integer("shift_order").default(0).notNull(),
  // Matka: dara=main (1-100). Jambo: dara=jodi (1,2). Bombay Bazar: dara=jodi. akhar shared.
  daraRate: decimal("dara_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  daraCommission: decimal("dara_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  akharRate: decimal("akhar_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  akharCommission: decimal("akhar_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  // Jambo: triple (number_type 0). Bombay Bazar: triple pana. Unused for matka.
  tripleRate: decimal("triple_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  tripleCommission: decimal("triple_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  // Bombay Bazar only — additional rate buckets and the second (closing) result time.
  singlePanaRate: decimal("single_pana_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  singlePanaCommission: decimal("single_pana_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  doublePanaRate: decimal("double_pana_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  doublePanaCommission: decimal("double_pana_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  sangamRate: decimal("sangam_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  sangamCommission: decimal("sangam_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  closingTime: varchar("closing_time", { length: 30 }),
  mainJantriTime: varchar("main_jantri_time", { length: 30 }),
  isActive: boolean("is_active").default(true).notNull(),
  nextDayAllow: boolean("next_day_allow").default(false).notNull(),
  capping: decimal("capping", { precision: 15, scale: 2 }).default("0").notNull(),  // 0 = no limit
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transactions (header) ─────────────────────────────────────────────
export const matkaTransactions = pgTable("matka_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "no action" })
    .notNull(),
  shiftId: uuid("shift_id")
    .references(() => matkaShifts.id, { onDelete: "set null" }),
  transactionDate: date("transaction_date").notNull(),
  daraRate: decimal("dara_rate", { precision: 10, scale: 2 }).notNull(),
  daraCommission: decimal("dara_commission", { precision: 10, scale: 2 }).notNull(),
  akharRate: decimal("akhar_rate", { precision: 10, scale: 2 }).notNull(),
  akharCommission: decimal("akhar_commission", { precision: 10, scale: 2 }).notNull(),
  // Jambo-only rate snapshot (type 0). Stays "0" for matka transactions.
  tripleRate: decimal("triple_rate", { precision: 10, scale: 2 }).default("0").notNull(),
  tripleCommission: decimal("triple_commission", { precision: 10, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  totalCommission: decimal("total_commission", { precision: 15, scale: 2 }).default("0").notNull(),
  finalAmount: decimal("final_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  deviceType: varchar("device_type", { length: 10 }).default("WEB").notNull(),
  // ── Copy reference (which shift this was copied from) ──
  copyReferenceShiftId: uuid("copy_reference_shift_id")
    .references(() => matkaShifts.id, { onDelete: "set null" }),
  // ── Whitelabel tracking ──
  whitelabelId: uuid("whitelabel_id"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Details (individual number bets) ──────────────────────
export const matkaTransactionDetails = pgTable("matka_transaction_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .references(() => matkaTransactions.id, { onDelete: "no action" })
    .notNull(),
  numberType: integer("number_type").notNull(),                   // 1=main, 2/3=akhar, plus jambo 0-5 and bombay-bazar 0-6
  number: varchar("number", { length: 10 }).notNull(),            // matka "1"-"100" / "A0"-"B9", jambo "1"-"1000", bombay-bazar sangam "OOOCCC" (6)
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(),
  commission: decimal("commission", { precision: 10, scale: 2 }).default("0").notNull(),
  finalAmount: decimal("final_amount", { precision: 15, scale: 2 }).notNull(),
  orderNumber: integer("order_number").default(0).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Market Results ───────────────────────────────────────────────────────────
export const marketResults = pgTable("market_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  eventTypeId: bigint("event_type_id", { mode: "number" }).notNull(),
  competitionId: bigint("competition_id", { mode: "number" }),
  marketId: numeric("market_id").notNull().unique(),
  marketType: integer("market_type").default(MarketType.MatchOdds).notNull(), // 0=MatchOdds, 1=TiedMatch, 2=CompleteMatch, 3=Bookmaker, 4=Fancy
  status: varchar("status", { length: 20 }).default("PENDING").notNull(), // PENDING | DECLARED | VOID | ROLLBACK
  winnerId: bigint("winner_id", { mode: "number" }), // selectionId for odds/bookmaker, line value for fancy
  winnerName: varchar("winner_name", { length: 255 }),
  runners: jsonb("runners").$type<{ selectionId: number; name: string; result: string }[]>(), // full result per runner
  source: varchar("source", { length: 20 }).default("api").notNull(), // api | manual
  runs: integer("runs"),              // matka/fancy result runs (null = not declared)
  apiResponse: jsonb("api_response"), // raw external API response for audit
  settledAt: timestamp("settled_at"), // when bets were actually settled against this result
  declaredAt: timestamp("declared_at"), // when result was first declared
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Logs ──────────────────────────────────────────────────
export const matkaTransactionLogs = pgTable("matka_transaction_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  matkaTransactionId: uuid("matka_transaction_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Commissions ──────────────────────────────────────────
export const matkaTransactionCommissions = pgTable("matka_transaction_commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  matkaTransactionId: uuid("matka_transaction_id").notNull(),
  agentId: uuid("agent_id"),
  agentPercent: decimal("agent_percent", { precision: 5, scale: 2 }).default("0"),
  masterId: uuid("master_id"),
  masterPercent: decimal("master_percent", { precision: 5, scale: 2 }).default("0"),
  superId: uuid("super_id"),
  superPercent: decimal("super_percent", { precision: 5, scale: 2 }).default("0"),
  adminId: uuid("admin_id"),
  adminPercent: decimal("admin_percent", { precision: 5, scale: 2 }).default("0"),
  ownerId: uuid("owner_id"),
  ownerPercent: decimal("owner_percent", { precision: 5, scale: 2 }).default("0"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transactions Declare (archive after result declared) ─────────────
export const matkaTransactionsDeclare = pgTable("matka_transactions_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  shiftId: uuid("shift_id"),
  transactionDate: date("transaction_date").notNull(),
  daraRate: decimal("dara_rate", { precision: 10, scale: 2 }).notNull(),
  daraCommission: decimal("dara_commission", { precision: 10, scale: 2 }).notNull(),
  akharRate: decimal("akhar_rate", { precision: 10, scale: 2 }).notNull(),
  akharCommission: decimal("akhar_commission", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  totalCommission: decimal("total_commission", { precision: 15, scale: 2 }).default("0").notNull(),
  finalAmount: decimal("final_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  deviceType: varchar("device_type", { length: 10 }).default("WEB").notNull(),
  copyReferenceShiftId: uuid("copy_reference_shift_id"),
  whitelabelId: uuid("whitelabel_id"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Details Declare (archive) ──────────────────────────
export const matkaTransactionDetailsDeclare = pgTable("matka_transaction_details_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull(),
  numberType: integer("number_type").notNull(),
  number: varchar("number", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(),
  commission: decimal("commission", { precision: 10, scale: 2 }).default("0").notNull(),
  finalAmount: decimal("final_amount", { precision: 15, scale: 2 }).notNull(),
  orderNumber: integer("order_number").default(0).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Logs Declare (archive) ─────────────────────────────
export const matkaTransactionLogsDeclare = pgTable("matka_transaction_logs_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  matkaTransactionId: uuid("matka_transaction_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Matka Transaction Commissions Declare (archive) ──────────────────────
export const matkaTransactionCommissionsDeclare = pgTable("matka_transaction_commissions_declare", {
  id: uuid("id").primaryKey().defaultRandom(),
  matkaTransactionId: uuid("matka_transaction_id").notNull(),
  agentId: uuid("agent_id"),
  agentPercent: decimal("agent_percent", { precision: 5, scale: 2 }).default("0"),
  masterId: uuid("master_id"),
  masterPercent: decimal("master_percent", { precision: 5, scale: 2 }).default("0"),
  superId: uuid("super_id"),
  superPercent: decimal("super_percent", { precision: 5, scale: 2 }).default("0"),
  adminId: uuid("admin_id"),
  adminPercent: decimal("admin_percent", { precision: 5, scale: 2 }).default("0"),
  ownerId: uuid("owner_id"),
  ownerPercent: decimal("owner_percent", { precision: 5, scale: 2 }).default("0"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Declare Result (matka result declaration) ─────────────────────────────
export const declareResult = pgTable("declare_result", {
  declareId: uuid("declare_id").primaryKey().defaultRandom(),
  shiftId: uuid("shift_id").notNull(),
  declareDate: date("declare_date").notNull(),
  declareNumber: integer("declare_number").notNull(),
  isNeeded: integer("is_needed").default(0),
  redeclareNos: integer("redeclare_nos").default(0),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── User Multimarkets ────────────────────────────────────────────────────────
// Per-user pinned markets. A user can pin individual markets from multiple
// events; the /multimarket page surfaces just those markets with live odds.
// Market identity (market_id, name, type) is cached here because the market
// catalog is not persisted — it lives in the external sports API.
// Event / competition / sport names are cached too so the page still renders
// if the parent rows are later removed.
export const userMultimarkets = pgTable("user_multimarkets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  sportId: bigint("sport_id", { mode: "number" }).notNull(),
  sportName: varchar("sport_name", { length: 100 }).notNull(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull(),
  competitionName: varchar("competition_name", { length: 200 }).notNull(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  eventName: varchar("event_name", { length: 255 }).notNull(),
  openDate: timestamp("open_date"),
  marketId: varchar("market_id", { length: 50 }).notNull(),
  marketName: varchar("market_name", { length: 200 }).notNull(),
  marketType: varchar("market_type", { length: 50 }).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("uq_user_multimarket").on(table.userId, table.marketId),
]);

export const bombay_bazar_number = pgTable("bombay_bazar_number", {
  number_order: numeric("number_order"),
  game_number: numeric("game_number"),
})

// ── Staff Management — Permissions / Roles / Assignments / Overrides ─────────
// Layered RBAC on top of the existing UserRole hierarchy. The 6 user roles
// (Owner / Admin / Super / Master / Agent / User) continue to govern data
// scope (whose users/whitelabel you see). These tables govern WHICH FEATURES
// a staff member can use within their scope. Owner role bypasses these checks
// entirely — see services/permissions.ts.

/** Catalog of every permission key in the system (e.g. "banners.create"). Seeded. */
export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  group: varchar("group", { length: 50 }).notNull(),
  label: varchar("label", { length: 150 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Reusable role templates ("Sports Manager", "Finance Manager", ...). */
export const staffRoles = pgTable("staff_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  /** Which user-tier this template targets (Admin/Super/Master/Agent). */
  scopeRole: integer("scope_role").notNull(),
  /** NULL = global template (Owner-defined). Set = whitelabel-private template. */
  whitelabelId: uuid("whitelabel_id"),
  /** Seeded defaults: cloneable but not deletable. */
  isSystem: boolean("is_system").default(false).notNull(),
  createdBy: uuid("created_by"),
  // ── Audit ──
  addedBy: uuid("added_by").default(SYSTEM_USER_ID).notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").default(SYSTEM_USER_ID).notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
}, (table) => [
  unique("uq_staff_role_name_per_scope").on(table.name, table.whitelabelId),
]);

/** M2M: which permissions belong to which role template. */
export const staffRolePermissions = pgTable("staff_role_permissions", {
  staffRoleId: uuid("staff_role_id").notNull().references(() => staffRoles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  unique("pk_staff_role_permission").on(table.staffRoleId, table.permissionId),
]);

/** Assignment of a staff role to a user (one role per user in v1). */
export const userStaffRole = pgTable("user_staff_role", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  staffRoleId: uuid("staff_role_id").notNull().references(() => staffRoles.id, { onDelete: "restrict" }),
  assignedBy: uuid("assigned_by"),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
});

/** Per-user GRANT/DENY overrides on top of the role's permissions. DENY wins. */
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  /** "GRANT" or "DENY". DENY always wins over role default + GRANT. */
  effect: varchar("effect", { length: 5 }).notNull(),
  grantedBy: uuid("granted_by"),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
}, (table) => [
  unique("uq_user_permission").on(table.userId, table.permissionId),
]);

// ── Indexes ──────────────────────────────────────────────────────────────────
export const currencyValueHistoryIndex = { table: currencyValueHistory, columns: [currencyValueHistory.currencyId] as const };

export const sportsIndexes = [
  { table: sports, columns: [sports.is_active] },
  { table: sports, columns: [sports.sort_order] },
  { table: competitions, columns: [competitions.sport_id] },
  { table: competitions, columns: [competitions.is_active] },
  { table: competitions, columns: [competitions.competition_id] },
];



