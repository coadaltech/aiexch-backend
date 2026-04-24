-- ============================================================
-- 0089 — Add triple_rate / triple_commission to matka_shifts and
-- matka_transactions. Jambo (sport_type=1004) uses these for
-- number_type=0 (triple); matka never reads them.
--
-- In Jambo:
--   number_type 0   → triple_rate    (default 1000)
--   number_type 1,2 → dara_rate      (jodi rate, default 100)
--   number_type 3-5 → akhar_rate     (default 10)
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.matka_shifts
    ADD COLUMN IF NOT EXISTS triple_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS triple_commission numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.matka_transactions
    ADD COLUMN IF NOT EXISTS triple_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS triple_commission numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.matka_transactions_declare
    ADD COLUMN IF NOT EXISTS triple_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS triple_commission numeric(10,2) NOT NULL DEFAULT 0;
