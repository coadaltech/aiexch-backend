-- ============================================================
-- 0087 — Drop legacy `id` column + old PK on profiles and
-- ledger_limit, promote `user_id` to primary key.
--
-- schema.ts has user_id as the sole PK on both tables, but the
-- live DB still carries an old `id` column with the primary-key
-- constraint on it. drizzle-kit push can't add a second PK, so
-- we clean the DB state manually before re-pushing.
--
-- Safe to re-run.
-- ============================================================

-- ── profiles ───────────────────────────────────────────────
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND contype = 'p';

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', pk_name);
    END IF;
END$$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS id;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);

-- ── ledger_limit ───────────────────────────────────────────
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'public.ledger_limit'::regclass AND contype = 'p';

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.ledger_limit DROP CONSTRAINT %I', pk_name);
    END IF;
END$$;

ALTER TABLE public.ledger_limit DROP COLUMN IF EXISTS id;

ALTER TABLE public.ledger_limit
    ADD CONSTRAINT ledger_limit_pkey PRIMARY KEY (user_id);
