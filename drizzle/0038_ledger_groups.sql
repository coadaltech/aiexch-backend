-- Create ledger_groups table
CREATE TABLE IF NOT EXISTS "ledger_groups" (
  "ledger_group_id" integer PRIMARY KEY NOT NULL,
  "ledger_group_name" varchar(100) NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" varchar(50) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(50) DEFAULT 'system' NOT NULL
);--> statement-breakpoint
-- Seed predefined ledger groups (auto-insert, no application inserts)
INSERT INTO "ledger_groups" ("ledger_group_id", "ledger_group_name", "created_at", "updated_at", "created_by", "updated_by")
VALUES
  (0, 'owner', now(), now(), 'system', 'system'),
  (1, 'capital', now(), now(), 'system', 'system'),
  (2, 'profit and loss', now(), now(), 'system', 'system'),
  (3, 'Admin', now(), now(), 'system', 'system'),
  (4, 'super', now(), now(), 'system', 'system'),
  (5, 'master', now(), now(), 'system', 'system'),
  (6, 'agent', now(), now(), 'system', 'system'),
  (7, 'user', now(), now(), 'system', 'system')
ON CONFLICT ("ledger_group_id") DO NOTHING;--> statement-breakpoint
-- Add group_id and currency_id columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "group_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "currency_id" uuid;--> statement-breakpoint
-- Backfill group_id for existing users based on their role
UPDATE "users" SET "group_id" = CASE "role"
  WHEN 'owner' THEN 0
  WHEN 'admin' THEN 3
  WHEN 'super' THEN 4
  WHEN 'master' THEN 5
  WHEN 'agent' THEN 6
  WHEN 'user' THEN 7
  ELSE 7
END WHERE "group_id" IS NULL;
