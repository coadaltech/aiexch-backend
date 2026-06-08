ALTER TABLE "casino_bets" RENAME TO "casino_transactions";--> statement-breakpoint
ALTER TABLE "casino_transactions" RENAME CONSTRAINT "casino_bets_user_id_users_id_fk" TO "casino_transactions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "casino_transactions" RENAME CONSTRAINT "casino_bets_provider_bet_uniq" TO "casino_transactions_provider_bet_uniq";
