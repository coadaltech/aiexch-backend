ALTER TABLE "market_settings" ADD COLUMN "notice" varchar(500);--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "remark" varchar(500);--> statement-breakpoint
ALTER TABLE "transaction_details_declare" ADD COLUMN "remark" varchar(500);