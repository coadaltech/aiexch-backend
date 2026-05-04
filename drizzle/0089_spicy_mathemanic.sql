ALTER TABLE "matka_shifts" ADD COLUMN "single_pana_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "single_pana_commission" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "double_pana_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "double_pana_commission" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "sangam_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "sangam_commission" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_shifts" ADD COLUMN "closing_time" varchar(30);