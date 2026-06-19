-- ============================================================
-- 0104 — Add `is_highlight` flag to sports table.
--
-- Motivation: The owner needs a way to make a sport stand out in
-- the drop-header with the same highlighted "pinned" shimmer
-- treatment used for owner-pinned events. When `is_highlight =
-- true`, the sport tab renders with the shimmer pill; when false
-- (default), it renders as a normal sport tab.
--
-- Independent from `is_active` / `is_live` — purely cosmetic
-- emphasis in navigation.
--
-- Defaults to false so existing sports keep their normal look.
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.sports
    ADD COLUMN IF NOT EXISTS is_highlight boolean NOT NULL DEFAULT false;
