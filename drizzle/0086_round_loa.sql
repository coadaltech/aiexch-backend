ALTER TABLE "matka_shifts" ADD COLUMN "triple_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "triple_commission" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD COLUMN "triple_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD COLUMN "triple_commission" numeric(10, 2) DEFAULT '0' NOT NULL;