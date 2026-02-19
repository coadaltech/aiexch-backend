import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  date,
  decimal,
  integer,
  bigint,
  jsonb,
  PgTextBuilder,
  PgTable,
} from "drizzle-orm/pg-core";
import { generateNumericId, generateNumericRandomId } from "../utils/generateId";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("user"),
  membership: varchar("membership", { length: 20 }).default("bronze"),
  status: varchar("status", { length: 20 }).default("active"),
  balance: decimal("balance", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  emailVerified: boolean("email_verified").default(false),
  createdBy: bigint("created_by", { mode: "number" }),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const casino_games = pgTable("casino_games", {
  id: varchar("id", { length: 30 })
    .primaryKey()
    .$defaultFn(() => generateNumericId()),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  email: varchar("email", { length: 255 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  type: varchar("type", { length: 20 }).default("email_verification"),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const promotions = pgTable("promotions", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
      transactions: true,
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

export const transactions = pgTable("transactions", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  amount: decimal("amount", {
    scale: 2,
    precision: 16,
  }).notNull(),
  currency: varchar("currency", { length: 10 }).default("INR"),
  status: varchar("status", { length: 20 }).default("pending"),
  method: varchar("method", { length: 50 }),
  reference: varchar("reference", { length: 255 }),
  txnHash: varchar("txn_hash", { length: 255 }),
  proofImage: text("proof_image"),
  withdrawalAddress: text("withdrawl_address"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const kycDocuments = pgTable("kyc_documents", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  birthDate: date("birth_date"),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  address: text("address"),
  withdrawalAddress: text("withdrawal_address"),
  phone: varchar("phone", { length: 20 }),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const settings = pgTable("settings", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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

export const notifications = pgTable("notifications", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  notificationId: bigint("notification_id", { mode: "number" })
    .references(() => notifications.id, { onDelete: "cascade" })
    .notNull(),
  isRead: boolean("is_read").default(true),
  readAt: timestamp("read_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const qrCodes = pgTable("qr_codes", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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

export const bets = pgTable("bets", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  eventTypeId: varchar("event_type_id", { length: 50 }).notNull(), // Required for fetching results
  matchId: varchar("match_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  selectionId: varchar("selection_id", { length: 100 }).notNull(),
  marketName: varchar("market_name", { length: 255 }), // Human-readable market name
  runnerName: varchar("runner_name", { length: 255 }), // Human-readable runner/selection name
  marketType: varchar("market_type", { length: 20 }).default("odds"), // odds, bookmakers, sessions, fancy
  odds: decimal("odds", { precision: 10, scale: 2 }).notNull(),
  stake: decimal("stake", { precision: 10, scale: 2 }).notNull(),
  type: varchar("type", { length: 10 }).notNull(), // back, lay
  status: varchar("status", { length: 20 }).default("pending"), // pending, matched, won, lost, cancelled
  payout: decimal("payout", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  matchedAt: timestamp("matched_at"),
  settledAt: timestamp("settled_at"),
  cancelledAt: timestamp("cancelled_at"),
  resultCheckedAt: timestamp("result_checked_at"), // Track when results were last checked
});

export const accountStatements = pgTable("account_statements", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  userId: bigint("user_id", { mode: "number" })
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  name: varchar("name", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const homeSectionGames = pgTable("home_section_games", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
  sectionId: bigint("section_id", { mode: "number" })
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericId())),
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
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .$defaultFn(() => Number(generateNumericRandomId())),
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



// Create indexes
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