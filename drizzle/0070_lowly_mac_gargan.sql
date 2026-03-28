ALTER TABLE "matka_shifts" ADD COLUMN "next_day_allow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "capping" numeric(15, 2) DEFAULT '0' NOT NULL;