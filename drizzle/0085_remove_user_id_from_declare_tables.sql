-- ============================================================
-- 0085 — Drop user_id from declare archive tables.
--
-- transaction_commissions and transaction_logs had user_id
-- dropped in 0084. Their _declare counterparts still carry the
-- column with a NOT NULL constraint, which causes the
-- declare_process procedure to fail when it tries to copy rows
-- from the (now user_id-less) source tables.
--
-- Safe to re-run: DROP COLUMN IF EXISTS.
-- ============================================================

ALTER TABLE transaction_commissions_declare DROP COLUMN IF EXISTS user_id;

ALTER TABLE transaction_logs_declare DROP COLUMN IF EXISTS user_id;
