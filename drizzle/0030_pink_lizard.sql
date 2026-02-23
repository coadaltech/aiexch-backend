CREATE TYPE "public"."whitelabel_type" AS ENUM('B2B', 'B2C');--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "whitelabel_type" "whitelabel_type" DEFAULT 'B2C' NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "commission_percentage" numeric(5, 2) DEFAULT '0.00' NOT NULL;