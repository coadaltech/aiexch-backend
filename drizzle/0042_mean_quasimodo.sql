ALTER TABLE "profiles" ADD COLUMN "membership" varchar(20) DEFAULT 'bronze';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bet_status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "parent_bet_status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "balance" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "upline" numeric(5, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "downline" numeric(5, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "currency_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_login_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "membership";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "bet_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "parent_bet_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "balance";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "upline";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "downline";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "currency_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_login_ip";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_login_at";