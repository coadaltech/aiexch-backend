-- ============================================================
-- 0090 — Kalyan-New (sport_type=1005) shift fields.
-- Kalyan-New declares results twice a day (opening + closing) and
-- uses 6 rate buckets (single pana, double pana, triple pana, jodi,
-- akhar, sangam). Matka and Jambo never read these new columns.
--
-- Mapping (Kalyan-New only):
--   single_pana_rate  → NEW
--   double_pana_rate  → NEW
--   sangam_rate       → NEW
--   triple_rate       → triple pana (existing, shared with Jambo)
--   dara_rate         → jodi       (existing)
--   akhar_rate        → akhar      (existing)
--   closing_time      → second result time (NEW, nullable)
--   main_jantri_time  → opening time (existing column reused)
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.matka_shifts
    ADD COLUMN IF NOT EXISTS single_pana_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS single_pana_commission numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS double_pana_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS double_pana_commission numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sangam_rate numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sangam_commission numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS closing_time varchar(30);
