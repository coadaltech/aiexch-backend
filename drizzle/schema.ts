import { pgTable, bigint, varchar, text, integer, timestamp, unique, boolean, jsonb, foreignKey, numeric, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const banners = pgTable("banners", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	imageUrl: text("image_url").notNull(),
	linkUrl: text("link_url"),
	position: varchar({ length: 50 }).default('home'),
	order: integer().default(0),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const homeSections = pgTable("home_sections", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	subtitle: varchar({ length: 255 }),
	type: varchar({ length: 50 }).default('games').notNull(),
	order: integer().default(0),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const casinoGames = pgTable("casino_games", {
	id: varchar({ length: 30 }).primaryKey().notNull(),
	uuid: varchar({ length: 255 }).notNull(),
	name: text().notNull(),
	image: text().notNull(),
	type: varchar().notNull(),
	provider: varchar().notNull(),
	providerId: integer("provider_id").notNull(),
	technology: varchar().notNull(),
	hasLobby: boolean("has_lobby").default(false).notNull(),
	isMobile: boolean("is_mobile").default(false).notNull(),
	hasFreespins: boolean("has_freespins").default(false).notNull(),
	hasTables: boolean("has_tables").default(false).notNull(),
	tags: jsonb().default([]).notNull(),
	freespinValidUntilFullDay: integer("freespin_valid_until_full_day").default(0).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	label: varchar(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("casino_games_uuid_unique").on(table.uuid),
]);

export const kycDocuments = pgTable("kyc_documents", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	documentType: varchar("document_type", { length: 50 }).notNull(),
	documentUrl: text("document_url").notNull(),
	status: varchar({ length: 20 }).default('pending'),
	reviewNotes: text("review_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "kyc_documents_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const notifications = pgTable("notifications", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	message: text().notNull(),
	type: varchar({ length: 50 }).default('info'),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const otps = pgTable("otps", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	otp: varchar({ length: 6 }).notNull(),
	type: varchar({ length: 20 }).default('email_verification'),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	used: boolean().default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const popups = pgTable("popups", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	imageUrl: text("image_url").notNull(),
	targetPage: varchar("target_page", { length: 100 }).notNull(),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const bets = pgTable("bets", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	eventTypeId: varchar("event_type_id", { length: 50 }).notNull(),
	matchId: varchar("match_id", { length: 100 }).notNull(),
	marketId: varchar("market_id", { length: 100 }).notNull(),
	selectionId: varchar("selection_id", { length: 100 }).notNull(),
	marketName: varchar("market_name", { length: 255 }),
	runnerName: varchar("runner_name", { length: 255 }),
	marketType: varchar("market_type", { length: 20 }).default('odds'),
	odds: numeric({ precision: 10, scale:  2 }).notNull(),
	stake: numeric({ precision: 10, scale:  2 }).notNull(),
	type: varchar({ length: 10 }).notNull(),
	status: varchar({ length: 20 }).default('pending'),
	payout: numeric({ precision: 10, scale:  2 }).default('0'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	matchedAt: timestamp("matched_at", { mode: 'string' }),
	settledAt: timestamp("settled_at", { mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
	resultCheckedAt: timestamp("result_checked_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "bets_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const promocodes = pgTable("promocodes", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	code: varchar({ length: 50 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	value: varchar({ length: 100 }).notNull(),
	usageLimit: integer("usage_limit").default(1),
	usedCount: integer("used_count").default(0),
	validFrom: timestamp("valid_from", { mode: 'string' }),
	validTo: timestamp("valid_to", { mode: 'string' }),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("promocodes_code_unique").on(table.code),
]);

export const promotions = pgTable("promotions", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	type: varchar({ length: 50 }).notNull(),
	imageUrl: text("image_url"),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const qrCodes = pgTable("qr_codes", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	paymentMethod: varchar("payment_method", { length: 100 }).notNull(),
	currency: varchar({ length: 10 }).default('INR'),
	qrCodeUrl: text("qr_code_url"),
	walletAddress: text("wallet_address"),
	instructions: text(),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const settings = pgTable("settings", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	siteName: varchar("site_name", { length: 255 }).default('AIEXCH'),
	logo: text(),
	favicon: text(),
	authImage: text("auth_image"),
	theme: text().default('{"background":"#120a1c","foreground":"#fff8ec","card":"#221233","cardForeground":"#f4e2c8","primary":"#ffd85c","primaryForeground":"#1b1300","secondary":"#5b2e8a","secondaryForeground":"#f4e2c8","muted":"#3a275e","mutedForeground":"#d9c8b3","accent":"#ffbf4d","accentForeground":"#1c1400","border":"#3f2a60","input":"#6943a1","ring":"#ffd85c","popover":"#221233","popoverForeground":"#f4e2c8","success":"#5fc24d","error":"#e85854","info":"#009ed4","sidebar":"#120a1c","sidebarForeground":"#f4e2c8","sidebarPrimary":"#ffd85c","sidebarPrimaryForeground":"#1b1300","sidebarAccent":"#ffbf4d","sidebarAccentForeground":"#1c1400","sidebarBorder":"#3f2a60","sidebarRing":"#ffd85c"}'),
	maintenanceMode: boolean("maintenance_mode").default(false),
	maintenanceMessage: text("maintenance_message").default('We are currently performing scheduled maintenance. Please check back soon.'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const sportsGames = pgTable("sports_games", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	imageUrl: text("image_url"),
	linkPath: varchar("link_path", { length: 255 }),
	marketCount: integer("market_count").default(0),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const whitelabels = pgTable("whitelabels", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	domain: varchar({ length: 255 }).notNull(),
	title: varchar({ length: 255 }),
	description: text(),
	logo: text(),
	favicon: text(),
	contactEmail: varchar("contact_email", { length: 255 }),
	socialLinks: text("social_links"),
	status: varchar({ length: 20 }).default('active'),
	theme: text().default('{"primary":"#ffd85c","primaryForeground":"#1b1300","secondary":"#5b2e8a","secondaryForeground":"#f4e2c8","accent":"#ffbf4d","accentForeground":"#1c1400","card":"#221233","cardForeground":"#f4e2c8","muted":"#3a275e","mutedForeground":"#d9c8b3","border":"#3f2a60","input":"#6943a1","ring":"#ffd85c","foreground":"#fff8ec","success":"#5fc24d","error":"#e85854","info":"#009ed4","background":"#120a1c"}'),
	layout: text().default('{"sidebarType":"sidebar-1","bannerType":"banner-1"}'),
	config: text().default('{"dbName":"casino_main","s3FolderName":"casino-assets"}'),
	preferences: text().default('{"language":"en","currency":"INR","timezone":"UTC","dateFormat":"MM/DD/YYYY","enableLiveChat":true,"enableNotifications":true,"maintenanceMode":false}'),
	permissions: text().default('{"casino":true,"sports":true,"liveCasino":true,"promotions":true,"transactions":true,"userManagement":false,"reports":false,"settings":false}'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("whitelabels_domain_unique").on(table.domain),
]);

export const withdrawalMethods = pgTable("withdrawal_methods", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	currency: varchar({ length: 10 }).default('INR'),
	minAmount: varchar("min_amount", { length: 50 }).default('100'),
	maxAmount: varchar("max_amount", { length: 50 }).default('100000'),
	processingTime: varchar("processing_time", { length: 100 }).default('1-3 business days'),
	feePercentage: varchar("fee_percentage", { length: 10 }).default('0'),
	feeFixed: varchar("fee_fixed", { length: 50 }).default('0'),
	instructions: text(),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const users = pgTable("users", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	username: varchar({ length: 50 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }).notNull(),
	role: varchar({ length: 20 }).default('user'),
	membership: varchar({ length: 20 }).default('bronze'),
	status: varchar({ length: 20 }).default('active'),
	balance: numeric({ precision: 15, scale:  2 }).default('0').notNull(),
	emailVerified: boolean("email_verified").default(false),
	lastLoginIp: varchar("last_login_ip", { length: 45 }),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("users_username_unique").on(table.username),
	unique("users_email_unique").on(table.email),
]);

export const homeSectionGames = pgTable("home_section_games", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sectionId: bigint("section_id", { mode: "number" }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	image: text().notNull(),
	link: varchar({ length: 255 }).notNull(),
	popular: boolean().default(false),
	hot: boolean().default(false),
	order: integer().default(0),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [homeSections.id],
			name: "home_section_games_section_id_home_sections_id_fk"
		}).onDelete("cascade"),
]);

export const profiles = pgTable("profiles", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	firstName: varchar("first_name", { length: 100 }),
	lastName: varchar("last_name", { length: 100 }),
	birthDate: date("birth_date"),
	country: varchar({ length: 100 }),
	city: varchar({ length: 100 }),
	address: text(),
	withdrawalAddress: text("withdrawal_address"),
	phone: varchar({ length: 20 }),
	avatar: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const transactions = pgTable("transactions", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	amount: numeric({ precision: 16, scale:  2 }).notNull(),
	currency: varchar({ length: 10 }).default('INR'),
	status: varchar({ length: 20 }).default('pending'),
	method: varchar({ length: 50 }),
	reference: varchar({ length: 255 }),
	txnHash: varchar("txn_hash", { length: 255 }),
	proofImage: text("proof_image"),
	withdrawlAddress: text("withdrawl_address"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "transactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userReadNotifications = pgTable("user_read_notifications", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	notificationId: bigint("notification_id", { mode: "number" }).notNull(),
	isRead: boolean("is_read").default(true),
	readAt: timestamp("read_at", { mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_read_notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.notificationId],
			foreignColumns: [notifications.id],
			name: "user_read_notifications_notification_id_notifications_id_fk"
		}).onDelete("cascade"),
]);
