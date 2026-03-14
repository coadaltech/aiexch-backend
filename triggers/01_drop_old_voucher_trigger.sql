-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Drop the old voucher trigger (it reads amount from vouchers table,
-- which we no longer use). The new system uses triggers on voucher_details.
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_voucher_ledger_update ON vouchers;
DROP FUNCTION IF EXISTS trg_voucher_ledger_update();
