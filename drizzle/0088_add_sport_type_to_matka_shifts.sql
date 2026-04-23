-- ============================================================
-- 0088 — Add sport_type column to matka_shifts so the same
-- table can hold shifts for multiple sport families (Matka 1001,
-- Jambo 1004, ...). Existing rows default to 1001 (Matka).
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.matka_shifts
    ADD COLUMN IF NOT EXISTS sport_type integer NOT NULL DEFAULT 1001;

CREATE INDEX IF NOT EXISTS idx_matka_shifts_sport_type
    ON public.matka_shifts USING btree
    (sport_type ASC NULLS LAST)
    TABLESPACE pg_default;
