ALTER TABLE "account_statements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domains" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account_statements" CASCADE;--> statement-breakpoint
DROP TABLE "domains" CASCADE;--> statement-breakpoint
DROP TABLE "refresh_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" RENAME TO "transaction_commissions";--> statement-breakpoint
ALTER TABLE "transaction_commissions" DROP CONSTRAINT "bet_commission_snapshot_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_commissions" DROP CONSTRAINT "bet_commission_snapshot_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_commissions" ADD CONSTRAINT "transaction_commissions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_commissions" ADD CONSTRAINT "transaction_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;