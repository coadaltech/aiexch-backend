-- ============================================================
-- 0105 — Add `is_pinned` / `pin_label` to competitions table.
--
-- Motivation: The owner can already pin an EVENT to the site's top
-- drop-header under a custom label (see 0102 — events.is_pinned /
-- pin_label). This mirrors that for COMPETITIONS so the owner can
-- pin a whole competition straight to the header for quick access.
--
-- `is_pinned`  — true when the competition is shown in the drop-header.
-- `pin_label`  — the custom text shown in the header; null when unpinned.
--
-- Pinning respects per-whitelabel disables at read time (a whitelabel
-- that turned the competition off won't see the pinned entry).
--
-- Defaults keep existing competitions unpinned. Safe to re-run.
-- ============================================================

ALTER TABLE public.competitions
    ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE public.competitions
    ADD COLUMN IF NOT EXISTS pin_label varchar(120);
