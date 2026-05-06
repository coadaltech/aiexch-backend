-- ============================================================
-- 0093 — Add `transaction_limit` to ledger_limit.
--
-- Per-user cap on a single bet's stake. 0 (the default) means "no
-- per-bet cap" so existing rows are unaffected. When > 0, the
-- /betting/place handler rejects any individual stake above this
-- value — multiple bets at or below the cap are still allowed.
--
-- Lives on ledger_limit (not users) to keep all credit/limit
-- numbers on the same row that powers the owner users table.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.ledger_limit
    ADD COLUMN IF NOT EXISTS transaction_limit numeric(15, 2) NOT NULL DEFAULT 0;
