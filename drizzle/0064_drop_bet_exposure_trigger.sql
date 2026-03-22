-- Drop the old bet exposure trigger that was recalculating ledger on every bet insert.
-- Ledger updates will now be handled by a separate trigger (to be created by user).
DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_bet();
