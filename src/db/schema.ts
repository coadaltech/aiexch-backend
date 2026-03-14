import {
  pgTable,
  varchar,
  text,
  timestamp,
  boolean,
  date,
  decimal,
  integer,
  jsonb,
  pgEnum,
  uuid,
  serial,
} from "drizzle-orm/pg-core";

export const whitelabelTypeEnum = pgEnum("whitelabel_type", ["B2B", "B2C"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("user"),
  accountStatus: boolean("account_status").default(true).notNull(),
  parentAccountStatus: boolean("parent_account_status").default(true).notNull(),
  groupId: integer("group_id"),
  emailVerified: boolean("email_verified").default(false),
  whitelabelId: uuid("whitelabel_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const casino_games = pgTable("casino_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  uuid: varchar("uuid", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  image: text("image").notNull(), // only main image
  type: varchar("type").notNull(),
  provider: varchar("provider").notNull(),
  provider_id: integer("provider_id").notNull(),
  technology: varchar("technology").notNull(),
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
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
  label: varchar("label"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const otps = pgTable("otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  type: varchar("type", { length: 20 }).default("email_verification"),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(),
  imageUrl: text("image_url"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  imageUrl: text("image_url").notNull(),
  linkUrl: text("link_url"),
  position: varchar("position", { length: 50 }).default("home"),
  order: integer("order").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const popups = pgTable("popups", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  imageUrl: text("image_url").notNull(),
  targetPage: varchar("target_page", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const vouchers = pgTable("vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  userGroupId: integer("user_group_id"),
  type: varchar("type", { length: 20 }).notNull(), // credit | debit | limit | deposit | withdraw | bonus | settlement
  ledgerField: varchar("ledger_field", { length: 20 }), // user_balance | user_limit | both
  status: varchar("status", { length: 20 }).default("pending"), // pending | approved | rejected
  remarks: text("remarks"),
  method: varchar("method", { length: 50 }),
  reference: varchar("reference", { length: 255 }),
  proofImage: text("proof_image"),
  withdrawalAddress: text("withdrawal_address"),
  transactionId: uuid("transaction_id"),
  referenceId: varchar("reference_id", { length: 255 }),
  createdBy: uuid("created_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const voucherDetails = pgTable("voucher_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  voucherId: uuid("voucher_id")
    .references(() => vouchers.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  userGroupId: integer("user_group_id"),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  drCr: varchar("dr_cr", { length: 10 }), // DEBIT | CREDIT
  commissionPercent: decimal("commission_percent", { precision: 5, scale: 2 }),
  balanceBefore: decimal("balance_before", { precision: 15, scale: 2 }),
  balanceAfter: decimal("balance_after", { precision: 15, scale: 2 }),
  accountType: varchar("account_type", { length: 20 }), // ledger | capital | sport_pnl
  role: varchar("role", { length: 20 }), // owner|admin|super|master|agent|user|capital|pnl
  eventId: varchar("event_id", { length: 100 }),
  marketId: varchar("market_id", { length: 100 }),
  betId: uuid("bet_id"),
  whitelabelId: uuid("whitelabel_id"),
  description: varchar("description", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const kycDocuments = pgTable("kyc_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  documentUrl: text("document_url").notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  membership: varchar("membership", { length: 20 }).default("bronze"),
  betStatus: boolean("bet_status").default(true).notNull(),
  parentBetStatus: boolean("parent_bet_status").default(true).notNull(),
  upline: decimal("upline", { precision: 5, scale: 2 }).default("0.00"),
  downline: decimal("downline", { precision: 5, scale: 2 }).default("0.00"),
  currencyId: uuid("currency_id"),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  birthDate: date("birth_date"),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  address: text("address"),
  withdrawalAddress: text("withdrawal_address"),
  phone: varchar("phone", { length: 20 }),
  avatar: text("avatar"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const ledgerGroups = pgTable("ledger_groups", {
  ledgerGroupsid: serial("ledger_group_id").primaryKey().notNull(),
  ledgerGroupsname: varchar("ledger_group_name", { length: 100 }).notNull(),
  createdBy: varchar("created_by", { length: 50 }).default("system").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
  updatedBy: varchar("updated_by", { length: 50 }).default("system").notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).default("info"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  createdAt: timestamp("created_at").defaultNow(),
});

export const qrCodes = pgTable("qr_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentMethod: varchar("payment_method", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("INR"),
  qrCodeUrl: text("qr_code_url"),
  walletAddress: text("wallet_address"),
  instructions: text("instructions"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  whitelabelId: uuid("whitelabel_id"),
  eventTypeId: varchar("event_type_id", { length: 50 }).notNull(),
  matchId: varchar("match_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  marketName: varchar("market_name", { length: 255 }),
  marketType: varchar("market_type", { length: 20 }).default("odds"), // odds | bookmakers | sessions | fancy
  selectionId: varchar("selection_id", { length: 100 }).notNull(),
  selectionName: varchar("selection_name", { length: 255 }),
  betType: varchar("bet_type", { length: 10 }).notNull(), // back | lay
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  odds: decimal("odds", { precision: 10, scale: 4 }).notNull(),
  status: varchar("status", { length: 20 }).default("matched"), // matched | won | lost | cancelled | void
  settledAmount: decimal("settled_amount", { precision: 15, scale: 2 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
  matchedAt: timestamp("matched_at"),
  settledAt: timestamp("settled_at"),
  cancelledAt: timestamp("cancelled_at"),
  resultCheckedAt: timestamp("result_checked_at"),
});

export const transactionDetails = pgTable("transaction_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .references(() => transactions.id, { onDelete: "cascade" })
    .notNull(),
  runnerId: varchar("runner_id", { length: 100 }).notNull(),
  runnerName: varchar("runner_name", { length: 255 }),
  isUserSelection: boolean("is_user_selection").default(false).notNull(),
  betType: varchar("bet_type", { length: 10 }), // back | lay
  price: decimal("price", { precision: 10, scale: 4 }).notNull(),
  run: decimal("run", { precision: 10, scale: 2 }).default("0"),
  stake: decimal("stake", { precision: 15, scale: 2 }).notNull(),
  potentialReturn: decimal("potential_return", { precision: 15, scale: 2 }).notNull(),
});

export const accountStatements = pgTable("account_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  statementType: varchar("statement_type", { length: 50 }).default("monthly"),
  period: varchar("period", { length: 50 }).notNull(), // "December 2023"
  openingBalance: decimal("opening_balance", {
    precision: 10,
    scale: 2,
  }).notNull(),
  closingBalance: decimal("closing_balance", {
    precision: 10,
    scale: 2,
  }).notNull(),
  totalDeposits: decimal("total_deposits", { precision: 10, scale: 2 }).default(
    "0"
  ),
  totalWithdrawals: decimal("total_withdrawals", {
    precision: 10,
    scale: 2,
  }).default("0"),
  totalBets: decimal("total_bets", { precision: 10, scale: 2 }).default("0"),
  totalWinnings: decimal("total_winnings", { precision: 10, scale: 2 }).default(
    "0"
  ),
  commission: decimal("commission", { precision: 10, scale: 2 }).default("0"),
  netResult: decimal("net_result", { precision: 10, scale: 2 }).default("0"),
  status: varchar("status", { length: 20 }).default("available"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sportsGames = pgTable("sports_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  imageUrl: text("image_url"),
  linkPath: varchar("link_path", { length: 255 }),
  marketCount: integer("market_count").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const homeSections = pgTable("home_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 255 }),
  type: varchar("type", { length: 50 }).notNull().default("games"),
  order: integer("order").default(0),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const withdrawalMethods = pgTable("withdrawal_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("INR"),
  minAmount: varchar("min_amount", { length: 50 }).default("100"),
  maxAmount: varchar("max_amount", { length: 50 }).default("100000"),
  processingTime: varchar("processing_time", { length: 100 }).default(
    "1-3 business days"
  ),
  feePercentage: varchar("fee_percentage", { length: 10 }).default("0"),
  feeFixed: varchar("fee_fixed", { length: 50 }).default("0"),
  instructions: text("instructions"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});


// Add these to your existing schema file

export const sports = pgTable("sports", {
  id: uuid("id").primaryKey().defaultRandom(),
  sport_id: varchar("sport_id", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  is_active: boolean("is_active").default(true),
  sort_order: integer("sort_order").default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const competitions = pgTable("competitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  competition_id: varchar("competition_id", { length: 50 }).notNull().unique(),
  sport_id: varchar("sport_id", { length: 50 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  provider: varchar("provider", { length: 50 }),
  is_active: boolean("is_active").default(false),
  is_archived: boolean("is_archived").default(false),
  metadata: jsonb("metadata").default({}),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Managed currencies (owner-only): code, name, country, current value
export const currencies = pgTable("currencies", {

  
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  countryName: varchar("country_name", { length: 100 }).notNull(),
  value: decimal("value", { precision: 18, scale: 6 }).notNull().default("1"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// History of currency value changes (when owner updates a currency value)
export const currencyValueHistory = pgTable("currency_value_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  currencyId: uuid("currency_id")
    .references(() => currencies.id, { onDelete: "cascade" })
    .notNull(),
  value: decimal("value", { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  deviceType: varchar("device_type", { length: 20 }), // desktop | mobile | tablet | unknown
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  status: varchar("status", { length: 20 }).default("success"), // success | failed
  failureReason: varchar("failure_reason", { length: 255 }),
  loginAt: timestamp("login_at").defaultNow(),
  logoutAt: timestamp("logout_at"),
  sessionDurationSeconds: integer("session_duration_seconds"), // filled on logout
  createdAt: timestamp("created_at").defaultNow(),
});

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
  deviceType: varchar("device_type", { length: 20 }), // desktop | mobile | tablet | unknown
  deviceBrand: varchar("device_brand", { length: 100 }),
  deviceModel: varchar("device_model", { length: 100 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  addedBy: uuid("added_by"),
  addedAt: timestamp("added_at").defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()),
});

// ── Events (matches) with admin controls ─────────────────────
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: varchar("event_id", { length: 100 }).notNull().unique(),
  competitionId: varchar("competition_id", { length: 50 }).notNull(),
  sportId: varchar("sport_id", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  openDate: timestamp("open_date"),
  whitelabelId: uuid("whitelabel_id"),

  // Admin controls
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),
  suspended: boolean("suspended").default(false).notNull(),
  betDelay: integer("bet_delay").default(0).notNull(),
  maxMarketProfit: decimal("max_market_profit", { precision: 15, scale: 2 }),

  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Markets with admin overrides ─────────────────────────────
export const marketSettings = pgTable("market_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: varchar("market_id", { length: 100 }).notNull().unique(),
  eventId: varchar("event_id", { length: 100 }).notNull(),
  marketName: varchar("market_name", { length: 255 }).notNull(),
  marketType: varchar("market_type", { length: 50 }).notNull(),
  bettingType: varchar("betting_type", { length: 20 }).notNull(),
  provider: varchar("provider", { length: 50 }).default("API"),
  whitelabelId: uuid("whitelabel_id"),

  // Admin controls
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Runners with admin overrides ─────────────────────────────
export const runnerSettings = pgTable("runner_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  selectionId: varchar("selection_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  sortPriority: integer("sort_priority").default(0),

  // Admin controls
  isActive: boolean("is_active").default(true).notNull(),
  isVisible: boolean("is_visible").default(true).notNull(),

  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Custom market odds (admin-set, for custom markets) ───────
export const customMarketOdds = pgTable("custom_market_odds", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  selectionId: varchar("selection_id", { length: 100 }).notNull(),
  // Up to 3 back and 3 lay prices per runner: [{price: number, size: number}]
  backPrices: jsonb("back_prices").$type<{ price: number; size: number }[]>().default([]),
  layPrices: jsonb("lay_prices").$type<{ price: number; size: number }[]>().default([]),
  line: decimal("line", { precision: 10, scale: 2 }),

  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Market odds history (batch-inserted by background worker) ─
export const marketOddsHistory = pgTable("market_odds_history", {
  id: serial("id").primaryKey(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  eventId: varchar("event_id", { length: 100 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  capturedAt: timestamp("captured_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Bet commission snapshot — freezes hierarchy % at bet placement time
export const betCommissionSnapshot = pgTable("bet_commission_snapshot", {
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
  createdAt: timestamp("created_at").defaultNow(),
});

// Create indexes
export const currencyValueHistoryIndex = { table: currencyValueHistory, columns: [currencyValueHistory.currencyId] as const };

export const sportsIndexes = [
  // Create index for is_active for faster filtering
  { table: sports, columns: [sports.is_active] },
  { table: sports, columns: [sports.sort_order] },

  // Competition indexes
  { table: competitions, columns: [competitions.sport_id] },
  { table: competitions, columns: [competitions.is_active] },
  { table: competitions, columns: [competitions.competition_id] },

  // Runner indexes
];