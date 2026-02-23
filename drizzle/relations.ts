import { relations } from "drizzle-orm/relations";
import { users, kycDocuments, accountStatements, bets, refreshTokens, homeSections, homeSectionGames, profiles, vouchers, userReadNotifications, notifications } from "./schema";

export const kycDocumentsRelations = relations(kycDocuments, ({one}) => ({
	user: one(users, {
		fields: [kycDocuments.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	kycDocuments: many(kycDocuments),
	accountStatements: many(accountStatements),
	bets: many(bets),
	refreshTokens: many(refreshTokens),
	profiles: many(profiles),
	vouchers: many(vouchers),
	userReadNotifications: many(userReadNotifications),
}));

export const accountStatementsRelations = relations(accountStatements, ({one}) => ({
	user: one(users, {
		fields: [accountStatements.userId],
		references: [users.id]
	}),
}));

export const betsRelations = relations(bets, ({one}) => ({
	user: one(users, {
		fields: [bets.userId],
		references: [users.id]
	}),
}));

export const refreshTokensRelations = relations(refreshTokens, ({one}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
}));

export const homeSectionGamesRelations = relations(homeSectionGames, ({one}) => ({
	homeSection: one(homeSections, {
		fields: [homeSectionGames.sectionId],
		references: [homeSections.id]
	}),
}));

export const homeSectionsRelations = relations(homeSections, ({many}) => ({
	homeSectionGames: many(homeSectionGames),
}));

export const profilesRelations = relations(profiles, ({one}) => ({
	user: one(users, {
		fields: [profiles.userId],
		references: [users.id]
	}),
}));

export const vouchersRelations = relations(vouchers, ({one}) => ({
	user: one(users, {
		fields: [vouchers.userId],
		references: [users.id]
	}),
}));

export const userReadNotificationsRelations = relations(userReadNotifications, ({one}) => ({
	user: one(users, {
		fields: [userReadNotifications.userId],
		references: [users.id]
	}),
	notification: one(notifications, {
		fields: [userReadNotifications.notificationId],
		references: [notifications.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({many}) => ({
	userReadNotifications: many(userReadNotifications),
}));