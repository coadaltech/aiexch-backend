-- Move balance tracking from profiles to ledger_limit.
-- All cash balance operations now use ledger_limit.user_balance.
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "balance";
