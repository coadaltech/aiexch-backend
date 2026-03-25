import { relations } from "drizzle-orm/relations";
import { users, kycDocuments, bets, homeSections, homeSectionGames, profiles, userReadNotifications, notifications } from "./schema";

export const kycDocumentsRelations = relations(kycDocuments, ({one}) => ({
	user: one(users, {
		fields: [kycDocuments.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	kycDocuments: many(kycDocuments),
	bets: many(bets),
	profiles: many(profiles),
	userReadNotifications: many(userReadNotifications),
}));

export const betsRelations = relations(bets, ({one}) => ({
	user: one(users, {
		fields: [bets.userId],
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
