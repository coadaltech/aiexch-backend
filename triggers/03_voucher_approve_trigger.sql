-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: When voucher status changes to 'approved', process all its
-- voucher_detail rows that haven't been applied yet (is_processed = FALSE).
--
-- This handles the pending → approved flow:
--   1. Admin creates voucher (pending) + voucher_details
--   2. voucher_details trigger sees status != approved → skips ledger update
--   3. Admin approves voucher → this trigger fires
--   4. This trigger processes each voucher_detail row, updating ledger
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_voucher_approve_process()
RETURNS TRIGGER AS $$
DECLARE
  v_detail RECORD;
  v_current_balance DECIMAL(15,2);
BEGIN
  -- Only act when status becomes 'approved'
  IF TG_OP = 'UPDATE' AND (OLD.status = 'approved' OR NEW.status <> 'approved') THEN
    RETURN NEW;
  END IF;

  -- Skip settlement vouchers — those are fully handled by the settlement trigger
  IF NEW.type = 'settlement' THEN
    RETURN NEW;
  END IF;

  -- Process all voucher_details that haven't been applied yet
  FOR v_detail IN
    SELECT id, user_id, amount, dr_cr
      FROM voucher_details
     WHERE voucher_id = NEW.id
       AND is_processed = FALSE  -- not yet processed
       AND dr_cr IS NOT NULL
     ORDER BY added_date ASC
  LOOP
    -- Get current balance (with lock)
    SELECT COALESCE(user_balance, 0)
      INTO v_current_balance
      FROM ledger_limit
     WHERE user_id = v_detail.user_id
     FOR UPDATE;

    IF v_current_balance IS NULL THEN
      CONTINUE;
    END IF;

    IF v_detail.dr_cr = 'CREDIT' THEN
      UPDATE ledger_limit
         SET user_balance = user_balance + v_detail.amount,
             user_limit   = user_limit + v_detail.amount,
             final_limit  = (user_limit + v_detail.amount) - limit_consumed,
             update_date   = NOW()
       WHERE user_id = v_detail.user_id;

    ELSIF v_detail.dr_cr = 'DEBIT' THEN
      UPDATE ledger_limit
         SET user_balance = user_balance - v_detail.amount,
             user_limit   = user_limit - v_detail.amount,
             final_limit  = (user_limit - v_detail.amount) - limit_consumed,
             update_date   = NOW()
       WHERE user_id = v_detail.user_id;
    END IF;

    -- Mark as processed
    UPDATE voucher_details
       SET is_processed = TRUE
     WHERE id = v_detail.id;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_approve ON vouchers;

CREATE TRIGGER trg_voucher_approve
AFTER UPDATE OF status ON vouchers
FOR EACH ROW
EXECUTE FUNCTION trg_voucher_approve_process();
