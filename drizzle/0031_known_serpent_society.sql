ALTER TABLE "users" ADD COLUMN "upline" numeric(5, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "downline" numeric(5, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "whitelabels" DROP COLUMN "commission_percentage";