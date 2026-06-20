-- ============================================================
-- 0107 — Add `casino_pinned_categories` table.
--
-- Motivation: The owner can pin casino lobby categories (ROULETTE,
-- LIVECASINO, …) so they surface in the site's top drop-header,
-- mirroring how events/competitions are pinned there (see 0102 /
-- 0105). The category catalogue is code-defined on the frontend
-- (lib/casino-categories.ts); this table only records which keys
-- are pinned.
--
-- Global (no per-whitelabel scoping). `is_pinned = true` → the
-- category shows in the drop-header. Rows are upserted by the owner
-- panel; absence of a row means "not pinned".
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.casino_pinned_categories (
    category_key  varchar(64) PRIMARY KEY,
    is_pinned     boolean NOT NULL DEFAULT true,
    added_by      uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    added_date    timestamp NOT NULL DEFAULT now(),
    update_by     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    update_date   timestamp NOT NULL DEFAULT now(),
    record_status integer NOT NULL DEFAULT 1
);
