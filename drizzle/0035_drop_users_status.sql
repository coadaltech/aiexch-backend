-- Remove legacy status column; effective status is now account_status + parent_account_status (and bet_status).
ALTER TABLE "users" DROP COLUMN IF EXISTS "status";
