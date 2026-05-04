-- ============================================================
-- 0091 — Widen matka_transaction_details.number (and the declare
-- archive) from varchar(4) → varchar(10).
--
-- Motivation: Kalyan-New (sport_type=1005) sangam bets concatenate
-- the opening + closing pana into the same `number` column
-- (e.g. open "114" + close "224" → "114224", 6 chars). The previous
-- 4-char limit could not hold this. 10 chars leaves headroom for
-- any future bet shape that needs a composite key.
--
-- Safe to re-run. Widening a varchar never loses data.
-- ============================================================

ALTER TABLE public.matka_transaction_details
    ALTER COLUMN number TYPE varchar(10);

ALTER TABLE public.matka_transaction_details_declare
    ALTER COLUMN number TYPE varchar(10);
