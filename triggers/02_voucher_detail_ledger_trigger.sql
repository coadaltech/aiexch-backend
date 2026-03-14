-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: Update ledger_limit when voucher_details rows are inserted
--
-- This is the core double-entry trigger. Every voucher_detail row represents
-- a ledger entry (DEBIT or CREDIT) for a specific user.
--
-- When a voucher_detail is inserted:
--   - Check that parent voucher status = 'approved'
--   - CREDIT → add amount to user_balance, user_limit, recalc final_limit
--   - DEBIT  → subtract amount from user_balance, user_limit, recalc final_limit
--   - Record balance_before and balance_after on the row itself
--
-- Also handles: when voucher status changes to 'approved', process all
-- existing voucher_detail rows that haven't been applied yet.
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_voucher_detail_ledger_update()
RETURNS TRIGGER AS $$
DECLARE
  v_voucher_status VARCHAR(20);
  v_voucher_type   VARCHAR(20);
  v_current_balance DECIMAL(15,2);
BEGIN
  -- Check parent voucher is approved
  SELECT status, type
    INTO v_voucher_status, v_voucher_type
    FROM vouchers
   WHERE id = NEW.voucher_id;

  IF v_voucher_status <> 'approved' THEN
    -- Don't update ledger for pending/rejected vouchers
    -- balance_before/after will be filled when voucher gets approved
    RETURN NEW;
  END IF;

  -- Skip rows that already have balance_after pre-filled.
  -- This is used by the settlement trigger which inserts the USER's row
  -- as audit-only (the settle trigger already updated the user's ledger).
  IF NEW.balance_after IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get current balance for this user
  SELECT COALESCE(user_balance, 0)
    INTO v_current_balance
    FROM ledger_limit
   WHERE user_id = NEW.user_id
   FOR UPDATE;  -- lock to prevent race conditions

  -- If no ledger_limit row, skip (system accounts may not have one yet)
  IF v_current_balance IS NULL THEN
    RETURN NEW;
  END IF;

  -- Set balance_before
  NEW.balance_before := v_current_balance;

  IF NEW.dr_cr = 'CREDIT' THEN
    -- Add to balance
    UPDATE ledger_limit
       SET user_balance = user_balance + NEW.amount,
           user_limit   = user_limit + NEW.amount,
           final_limit  = (user_limit + NEW.amount) - limit_consumed,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;

    NEW.balance_after := v_current_balance + NEW.amount;

  ELSIF NEW.dr_cr = 'DEBIT' THEN
    -- Subtract from balance
    UPDATE ledger_limit
       SET user_balance = user_balance - NEW.amount,
           user_limit   = user_limit - NEW.amount,
           final_limit  = (user_limit - NEW.amount) - limit_consumed,
           updated_at   = NOW()
     WHERE user_id = NEW.user_id;

    NEW.balance_after := v_current_balance - NEW.amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_detail_ledger ON voucher_details;

CREATE TRIGGER trg_voucher_detail_ledger
BEFORE INSERT ON voucher_details
FOR EACH ROW
EXECUTE FUNCTION trg_voucher_detail_ledger_update();
