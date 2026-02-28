-- Move columns from users table to profiles table
-- Add new columns to profiles
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "membership" varchar(20) DEFAULT 'bronze';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "bet_status" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parent_bet_status" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "balance" decimal(15,2) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "upline" decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "downline" decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "currency_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_login_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;--> statement-breakpoint

-- Migrate data from users to profiles (create profile if missing, update if exists)
INSERT INTO "profiles" ("user_id", "membership", "bet_status", "parent_bet_status", "balance", "upline", "downline", "currency_id", "last_login_ip", "last_login_at")
SELECT "id", "membership", "bet_status", "parent_bet_status", "balance", "upline", "downline", "currency_id", "last_login_ip", "last_login_at"
FROM "users"
WHERE "id" NOT IN (SELECT "user_id" FROM "profiles");--> statement-breakpoint

UPDATE "profiles" SET
  "membership" = "users"."membership",
  "bet_status" = "users"."bet_status",
  "parent_bet_status" = "users"."parent_bet_status",
  "balance" = "users"."balance",
  "upline" = "users"."upline",
  "downline" = "users"."downline",
  "currency_id" = "users"."currency_id",
  "last_login_ip" = "users"."last_login_ip",
  "last_login_at" = "users"."last_login_at"
FROM "users"
WHERE "profiles"."user_id" = "users"."id";--> statement-breakpoint

-- Drop moved columns from users table
ALTER TABLE "users" DROP COLUMN IF EXISTS "membership";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "bet_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "parent_bet_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "balance";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "upline";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "downline";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "currency_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_login_ip";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_login_at";
