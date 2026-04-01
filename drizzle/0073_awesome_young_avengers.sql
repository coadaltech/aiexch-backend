ALTER TABLE "transaction_details" ALTER COLUMN "added_date" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_date" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "matched_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "settled_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "cancelled_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "result_checked_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_date" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_date" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_date" SET DEFAULT now();