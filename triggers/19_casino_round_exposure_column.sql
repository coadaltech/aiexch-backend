-- ─────────────────────────────────────────────────────────────────────────────
-- casino_transactions.round_exposure
--
-- The NET worst-case liability for an Ace round, as Ace computes it (knowing the
-- full outcome set) and sends as the top-level `exposure` on /accounts/exposure.
-- We store it per round so set_limit_used_of_user holds the netted figure —
-- e.g. BACK A 100@2.32 + BACK B 100@1.72 on a 2-outcome market nets to 28, not
-- 100+100=200. Sports gets this for free because the bet request carries the
-- whole runner list; casino bets carry only the bet's own selection, so we keep
-- Ace's authoritative number here instead of guessing the unseen outcomes.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.casino_transactions
    ADD COLUMN IF NOT EXISTS round_exposure numeric(15,2);
