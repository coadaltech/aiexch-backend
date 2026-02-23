-- Account status: false = user cannot login. Bet status: false = cannot place bets.
-- Own status (account_status, bet_status) is set only by direct parent (creator).
-- Parent-derived (parent_account_status, parent_bet_status) = AND of all ancestors; cascade when ancestor changes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_status" boolean NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bet_status" boolean NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "parent_account_status" boolean NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "parent_bet_status" boolean NOT NULL DEFAULT true;
