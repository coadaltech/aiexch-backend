-- Remove commission column; only upline and downline are used as commission types
ALTER TABLE "users" DROP COLUMN IF EXISTS "commission";
