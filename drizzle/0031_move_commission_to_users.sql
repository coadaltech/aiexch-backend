-- Remove commission from whitelabels
ALTER TABLE "whitelabels" DROP COLUMN IF EXISTS "commission_percentage";

-- Add commission, upline, downline to users
-- ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commission" numeric(5,2) DEFAULT '0.00';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "upline" numeric(5,2) DEFAULT '0.00';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "downline" numeric(5,2) DEFAULT '0.00';
