ALTER TABLE "competitions" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "pin_label" varchar(120);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_cashout" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions_declare" ADD COLUMN "is_cashout" boolean DEFAULT false NOT NULL;