-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Voucher system redesign
--
-- 1. Rename old vouchers table (preserve data)
-- 2. Create new vouchers table with expanded schema
-- 3. Create voucher_details table for commission hierarchy
-- 4. Create trigger to auto-update ledger_limit on voucher approval
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Rename old vouchers table
ALTER TABLE IF EXISTS "vouchers" RENAME TO "vouchers_old";

-- Step 2: Create new vouchers table
CREATE TABLE "vouchers" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_group_id"      INTEGER,
  "type"               VARCHAR(20)  NOT NULL,           -- credit | debit | limit | deposit | withdraw | bonus | settlement
  "ledger_field"       VARCHAR(20),                     -- user_balance | user_limit | both
  "amount"             DECIMAL(15,2) NOT NULL,
  "status"             VARCHAR(20)  DEFAULT 'pending',  -- pending | approved | rejected
  "remarks"            TEXT,
  "method"             VARCHAR(50),
  "reference"          VARCHAR(255),
  "proof_image"        TEXT,
  "withdrawal_address" TEXT,
  "transaction_id"     UUID,
  "created_by"         UUID,
  "approved_by"        UUID,
  "approved_at"        TIMESTAMP,
  "created_at"         TIMESTAMP DEFAULT NOW(),
  "updated_at"         TIMESTAMP DEFAULT NOW()
);

-- Step 3: Create voucher_details table
CREATE TABLE "voucher_details" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "voucher_id"         UUID NOT NULL REFERENCES "vouchers"("id") ON DELETE CASCADE,
  "user_id"            UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_group_id"      INTEGER,
  "amount"             DECIMAL(15,2) NOT NULL,          -- signed: positive = credit, negative = debit
  "commission_percent" DECIMAL(5,2),
  "account_type"       VARCHAR(20),                     -- ledger | capital | sport_pnl
  "description"        VARCHAR(255),
  "created_at"         TIMESTAMP DEFAULT NOW()
);

-- Step 4: Trigger to update ledger_limit when a voucher is approved
--
-- All voucher types update BOTH user_balance and user_limit together:
--   credit/deposit/bonus/limit → ADD amount to balance, limit, final_limit
--   debit/withdraw             → SUBTRACT amount from balance, limit, final_limit
--
-- Bet placement only touches limit_consumed/final_limit (not balance).
-- Result declaration updates all fields via the settle trigger.
CREATE OR REPLACE FUNCTION trg_voucher_ledger_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when status becomes 'approved'
  IF TG_OP = 'UPDATE' AND (OLD.status = 'approved' OR NEW.status <> 'approved') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.type IN ('debit', 'withdraw') THEN
    -- Deduct from both balance and limit
    UPDATE ledger_limit
       SET user_balance = user_balance - NEW.amount,
           user_limit   = user_limit - NEW.amount,
           final_limit  = (user_limit - NEW.amount) - limit_consumed,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;
  ELSE
    -- Add to both balance and limit (limit, credit, deposit, bonus, settlement)
    UPDATE ledger_limit
       SET user_balance = user_balance + NEW.amount,
           user_limit   = user_limit + NEW.amount,
           final_limit  = (user_limit + NEW.amount) - limit_consumed,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_ledger_update ON vouchers;

CREATE TRIGGER trg_voucher_ledger_update
AFTER INSERT OR UPDATE OF status ON vouchers
FOR EACH ROW
EXECUTE FUNCTION trg_voucher_ledger_update();
