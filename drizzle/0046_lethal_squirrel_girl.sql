ALTER TABLE "transaction_details" ADD COLUMN "bet_type" varchar(10);--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "run" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "transaction_details" DROP COLUMN "actual_return";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "potential_payout";