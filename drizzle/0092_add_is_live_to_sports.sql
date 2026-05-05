-- ============================================================
-- 0092 — Add `is_live` flag to sports table.
--
-- Motivation: The owner needs a way to mark a sport as "Coming
-- Soon" without hiding it from navigation. When `is_live = true`
-- (default), the sport's page renders normally. When `is_live =
-- false`, the public sport page shows a Coming Soon banner.
--
-- Independent from `is_active`:
--   • is_active=false — sport is hidden everywhere (sidebar, header).
--   • is_active=true & is_live=false — sport is visible in nav, but
--     clicking it shows a Coming Soon banner instead of content.
--
-- Defaults to true so existing sports continue to render as live.
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.sports
    ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT true;
