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
} from "drizzle-orm/pg-core";
import { RecordStatus, BetType, UserRole, MembershipType, VoucherType, VoucherStatus, DrCr, MarketType } from "../types/enums";

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
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Casino Games ─────────────────────────────────────────────────────────────
export const casino_games = pgTable("casino_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  uuid: varchar("uuid", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  image: text("image").notNull(),
  type: varchar("type").notNull(),
  provider: varchar("provider").notNull(),
  provider_id: integer("provider_id").notNull(),
  technology: varchar("technology").notNull(),
  label: varchar("label"),
  has_lobby: boolean("has_lobby").notNull().default(false),
  is_mobile: boolean("is_mobile").notNull().default(false),
  has_freespins: boolean("has_freespins").notNull().default(false),
  has_tables: boolean("has_tables").notNull().default(false),
  tags: jsonb("tags")
    .$type<{ code: string; label: string }[]>()
    .notNull()
    .default([]),
  freespin_valid_until_full_day: integer("freespin_valid_until_full_day")
    .notNull()
    .default(0),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Ledger Groups ────────────────────────────────────────────────────────────
export const ledgerGroups = pgTable("ledger_groups", {
  ledgerGroupsid: serial("ledger_group_id").primaryKey().notNull(),
  ledgerGroupsname: varchar("ledger_group_name", { length: 100 }).notNull(),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  matchedAt: date("matched_at"),
  settledAt: date("settled_at"),
  cancelledAt: date("cancelled_at"),
  resultCheckedAt: date("result_checked_at"),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: date("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: date("update_date").defaultNow().$onUpdate(() => new Date().toISOString().split("T")[0]).notNull(),
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
  price: decimal("price", { precision: 10, scale: 4 }).notNull(),
  run: integer("run").default(0),
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  potentialReturn: decimal("potential_return", { precision: 15, scale: 2 }).notNull(),
  // ── Audit ──
  addedBy: uuid("added_by").notNull(),
  addedDate: date("added_date").defaultNow().notNull(),
  updateBy: uuid("update_by").notNull(),
  updateDate: date("update_date").defaultNow().$onUpdate(() => new Date().toISOString().split("T")[0]).notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Sports ───────────────────────────────────────────────────────────────────
export const sports = pgTable("sports", {
  id: uuid("id").primaryKey().defaultRandom(),
  sport_id: bigint("sport_id", { mode: "number" }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  is_active: boolean("is_active").default(true),
  sort_order: integer("sort_order").default(0),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  is_archived: boolean("is_archived").default(false),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Currencies ───────────────────────────────────────────────────────────────
export const currencies = pgTable("currencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  countryName: varchar("country_name", { length: 100 }).notNull(),
  value: decimal("value", { precision: 18, scale: 6 }).notNull().default("1"),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Logs ─────────────────────────────────────────────────────────
export const transactionLogs = pgTable("transaction_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .references(() => transactions.id, { onDelete: "cascade" })
    .notNull(),
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
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  limitConsumedAfterDeclare: decimal("limit_consumed_after_declare", { precision: 15, scale: 2 }).default("0").notNull(),
  finalLimit: decimal("final_limit", { precision: 15, scale: 2 }).default("0").notNull(),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  suspended: boolean("suspended").default(false).notNull(),
  betDelay: integer("bet_delay").default(0).notNull(),
  maxMarketProfit: decimal("max_market_profit", { precision: 15, scale: 2 }),
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

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
  metadata: jsonb("metadata").default({}),
  // ── Audit ──
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Transaction Commissions ──────────────────────────────────────────────────
export const transactionCommissions = pgTable("transaction_commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .references(() => transactions.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
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
  addedBy: varchar("added_by", { length: 50 }).default("system").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  updateBy: varchar("update_by", { length: 50 }).default("system").notNull(),
  updateDate: timestamp("update_date").defaultNow().$onUpdate(() => new Date()).notNull(),
  recordStatus: integer("record_status").default(RecordStatus.Active).notNull(),
});

// ── Indexes ──────────────────────────────────────────────────────────────────
export const currencyValueHistoryIndex = { table: currencyValueHistory, columns: [currencyValueHistory.currencyId] as const };

export const sportsIndexes = [
  { table: sports, columns: [sports.is_active] },
  { table: sports, columns: [sports.sort_order] },
  { table: competitions, columns: [competitions.sport_id] },
  { table: competitions, columns: [competitions.is_active] },
  { table: competitions, columns: [competitions.competition_id] },
];



