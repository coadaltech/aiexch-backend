-- ─────────────────────────────────────────────────────────────
-- FIX: Unified exposure calculation for ODDS + SESSIONS
--
-- The previous trigger (0054) used SUM(stake) for session markets,
-- which is incorrect for lay bets where worst-case loss is
-- (potential_return - stake), not stake.
--
-- This migration aligns the bet-placement trigger with the
-- settlement trigger (0051) by using a unified worst-case P&L
-- model for both odds and session markets.
--
-- For each market, we enumerate all possible outcomes and compute
-- the net P&L across all bets. The worst (minimum) P&L per market
-- is the exposure for that market.
--
-- Session markets have two outcomes:
--   1. Runner wins (YES) — identified by selected_runner_id
--   2. Runner loses (NO)  — identified by synthetic '__NO__' id
-- ─────────────────────────────────────────────────────────────

-- Drop old trigger
DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;

-- Drop old function
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_bet();


CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_bet()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id         UUID;
  v_user_limit      NUMERIC(15,2);
  v_final_limit     NUMERIC(15,2);
  v_total_exposure  NUMERIC(15,2);
BEGIN

  -- Get user from parent transaction
  SELECT t.user_id
    INTO v_user_id
    FROM transactions t
   WHERE t.id = NEW.transaction_id;

  -- Lock ledger row (prevents race condition)
  SELECT user_limit, final_limit
    INTO v_user_limit, v_final_limit
    FROM ledger_limit
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_user_limit IS NULL THEN
    RAISE EXCEPTION 'Ledger not found';
  END IF;

  IF v_final_limit <= 0 THEN
    RAISE EXCEPTION
      'Bet rejected: no available limit (final limit %)', v_final_limit;
  END IF;

  -- Rule 1: stake must not exceed available limit
  IF NEW.stake::NUMERIC > v_final_limit THEN
    RAISE EXCEPTION
      'Bet rejected: stake % exceeds your available limit %',
      NEW.stake::NUMERIC, v_final_limit;
  END IF;


  -- ─────────────────────────────────────────────────────────
  -- UNIFIED WORST-CASE EXPOSURE (Odds + Sessions)
  -- ─────────────────────────────────────────────────────────
  --
  -- 1. Collect all active bets (selected runner row only)
  -- 2. Build list of possible outcomes per market:
  --    - Odds/Bookmaker: each distinct runner_id in that market
  --    - Sessions: runner_id (YES) + '__NO__' (NO)
  -- 3. For each (market, outcome), compute net P&L across all
  --    bets in that market
  -- 4. Take worst (minimum) P&L per market
  -- 5. Sum of |negative worst P&Ls| = total exposure

  WITH active_bets AS (
    SELECT
      t.market_id,
      t.market_type,
      td.bet_type,
      td.runner_id          AS selected_runner_id,
      td.stake::NUMERIC     AS stake,
      td.potential_return::NUMERIC AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = v_user_id
      AND t.status = 'matched'
  ),

  -- All possible outcomes per market
  market_outcomes AS (
    -- Odds/Bookmaker markets: each distinct runner is an outcome
    SELECT DISTINCT t.market_id, td.runner_id AS outcome_id
      FROM transactions t
      JOIN transaction_details td ON td.transaction_id = t.id
     WHERE t.user_id     = v_user_id
       AND t.status      = 'matched'
       AND t.market_type <> 'sessions'
    UNION
    -- Session markets: runner wins (YES outcome)
    SELECT DISTINCT market_id, selected_runner_id AS outcome_id
      FROM active_bets
     WHERE market_type = 'sessions'
    UNION
    -- Session markets: runner loses (NO outcome)
    SELECT DISTINCT market_id, '__NO__' AS outcome_id
      FROM active_bets
     WHERE market_type = 'sessions'
  ),

  -- Calculate P&L for each (market, outcome) combination
  pnl_calc AS (
    SELECT
      mo.market_id,
      mo.outcome_id,
      SUM(
        CASE ab.bet_type
          WHEN 'back' THEN
            CASE
              WHEN ab.selected_runner_id = mo.outcome_id
                THEN ab.potential_return - ab.stake   -- back bet wins
              ELSE -ab.stake                           -- back bet loses
            END
          ELSE -- lay
            CASE
              WHEN ab.selected_runner_id = mo.outcome_id
                THEN ab.stake - ab.potential_return   -- lay bet loses
              ELSE ab.stake                            -- lay bet wins
            END
        END
      ) AS pnl
    FROM market_outcomes mo
    JOIN active_bets ab ON ab.market_id = mo.market_id
    GROUP BY mo.market_id, mo.outcome_id
  ),

  -- Worst-case P&L per market
  worst_market AS (
    SELECT market_id, MIN(pnl) AS worst_pnl
    FROM pnl_calc
    GROUP BY market_id
  )

  SELECT COALESCE(SUM(
    CASE WHEN worst_pnl < 0 THEN ABS(worst_pnl) ELSE 0 END
  ), 0)
  INTO v_total_exposure
  FROM worst_market;


  -- Rule 2: total exposure must not exceed user limit
  IF v_total_exposure > v_user_limit THEN
    RAISE EXCEPTION
      'Bet rejected: total exposure % exceeds user limit %',
      v_total_exposure, v_user_limit;
  END IF;


  -- Update ledger
  UPDATE ledger_limit
     SET limit_consumed = v_total_exposure,
         final_limit    = user_limit - v_total_exposure,
         updated_at     = NOW()
   WHERE user_id = v_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Recreate trigger
CREATE TRIGGER trg_ledger_limit_on_bet
AFTER INSERT ON transaction_details
FOR EACH ROW
WHEN (NEW.is_user_selection = TRUE)
EXECUTE FUNCTION trg_recalc_ledger_on_bet();
