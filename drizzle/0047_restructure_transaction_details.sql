-- Remove actualReturn from transaction_details
ALTER TABLE "transaction_details" DROP COLUMN IF EXISTS "actual_return";

-- Add betType and run to transaction_details
ALTER TABLE "transaction_details" ADD COLUMN "bet_type" varchar(10);
ALTER TABLE "transaction_details" ADD COLUMN "run" numeric(10, 2) DEFAULT '0';

-- Remove potentialPayout and run from transactions
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "potential_payout";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "run";
