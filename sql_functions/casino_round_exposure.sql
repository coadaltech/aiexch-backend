-- ─────────────────────────────────────────────────────────────────────────────
-- Function: fn_casino_round_exposure(user_id)
--
-- Per-round casino exposure hold, returned as a positive amount, one row per
-- open round. set_limit_used_of_user sums it as the casino contribution to
-- limit_consumed; the exposure-usage modal groups it by game.
--
-- WHY THIS MIRRORS SPORTS (and why it isn't re-derived from the bets):
-- Sports nets correctly because the /place request carries the FULL runner
-- list, so it stores one transaction_details row per runner and takes the
-- per-market worst case over the real outcome set. Casino bets arrive from the
-- provider's wallet callback carrying ONLY the selection that was bet — we
-- never see the unbacked outcomes, so we cannot tell a 2-outcome market (where
-- backing A and B nets to a small loss) from a 3-outcome one (where a third
-- result makes both lose). Ace already does that netting knowing the full
-- market and sends the NET worst-case as the round's exposure, which the wallet
-- handler stores on casino_transactions.round_exposure (same value on every
-- matched row of the round). So:
--   • Ace rounds      → MAX(round_exposure)  (the netted figure: BACK A + BACK B
--                       on a 2-outcome market = 28, not 100+100; a hedge lowers
--                       it, a compounding bet raises it — exactly like sports).
--   • Other / legacy  → SUM(coalesce(exposure, stake))  (QTech seamless single
--                       bets, or pre-migration rows with no round figure).
-- Settled bets leave status='matched' and drop out, releasing the hold.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.casino_transactions
    ADD COLUMN IF NOT EXISTS round_exposure numeric(15,2);

DROP FUNCTION IF EXISTS public.fn_casino_round_exposure(uuid);

CREATE OR REPLACE FUNCTION public.fn_casino_round_exposure(varuser_id uuid)
RETURNS TABLE(
    provider   varchar,
    round_key  text,
    game_id    varchar,
    game_name  varchar,
    exposure   numeric
)
LANGUAGE sql
STABLE
AS $$
    WITH casino_matched AS (
        SELECT
            cb.provider,
            -- Null round_id (legacy seamless) → isolate the bet as its own round
            -- so it can't net against unrelated bets.
            COALESCE(cb.provider_round_id, cb.id::text) AS round_key,
            cb.game_id,
            cb.game_name,
            cb.stake::numeric          AS stake,
            cb.exposure::numeric       AS exposure,
            cb.round_exposure::numeric AS round_exposure
        FROM casino_transactions cb
        WHERE cb.user_id = varuser_id
          AND cb.status = 'matched'
          AND COALESCE(cb.record_status, 0) = 0
    )
    SELECT
        provider,
        round_key,
        MAX(game_id)   AS game_id,
        MAX(game_name) AS game_name,
        -- Ace's netted round figure when present; otherwise the per-bet sum.
        CASE
            WHEN MAX(round_exposure) IS NOT NULL THEN MAX(round_exposure)
            ELSE SUM(COALESCE(exposure, stake))
        END AS exposure
    FROM casino_matched
    GROUP BY provider, round_key
    HAVING (CASE
                WHEN MAX(round_exposure) IS NOT NULL THEN MAX(round_exposure)
                ELSE SUM(COALESCE(exposure, stake))
            END) <> 0;
$$;

ALTER FUNCTION public.fn_casino_round_exposure(uuid) OWNER TO postgres;
