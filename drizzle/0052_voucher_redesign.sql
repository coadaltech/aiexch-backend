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
CREATE OR REPLACE FUNCTION trg_voucher_ledger_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when status becomes 'approved'
  -- For INSERT: NEW.status must be 'approved'
  -- For UPDATE: OLD.status must NOT be 'approved' and NEW.status must be 'approved'
  IF TG_OP = 'UPDATE' AND (OLD.status = 'approved' OR NEW.status <> 'approved') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- Determine which field to update based on type (ledger_field overrides if set)
  IF NEW.type = 'limit' OR NEW.ledger_field = 'user_limit' THEN
    -- Admin assigning credit limit: add to user_limit, recalculate final_limit
    UPDATE ledger_limit
       SET user_limit  = user_limit + NEW.amount,
           final_limit = (user_limit + NEW.amount) - limit_consumed,
           updated_at  = NOW()
     WHERE user_id = NEW.user_id;

  ELSIF NEW.type IN ('credit', 'deposit', 'bonus') OR NEW.ledger_field = 'user_balance' THEN
    -- Add to cash balance
    UPDATE ledger_limit
       SET user_balance = user_balance + NEW.amount,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;

  ELSIF NEW.type IN ('debit', 'withdraw') THEN
    -- Subtract from cash balance
    UPDATE ledger_limit
       SET user_balance = user_balance - NEW.amount,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;

  ELSIF NEW.ledger_field = 'both' THEN
    -- Update both fields (special case)
    UPDATE ledger_limit
       SET user_limit   = user_limit + NEW.amount,
           final_limit  = (user_limit + NEW.amount) - limit_consumed,
           user_balance = user_balance + NEW.amount,
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
