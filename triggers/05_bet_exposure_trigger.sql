-- ---------------------------------------------------------------------------
-- Trigger: Recalculate ledger exposure on bet placement
--
-- Fires AFTER INSERT on transaction_details (for user-selection rows only).
-- Locks the user's ledger_limit row, then recalculates total exposure
-- using unified worst-case P&L model for all market types.
--
-- NO VALIDATION — all limit/exposure checks are done in the backend
-- BEFORE inserting into transactions/transaction_details.
-- This trigger ONLY updates the ledger_limit table.
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_bet();

CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_bet()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id         UUID;
  v_user_limit      NUMERIC(15,2);
  v_total_exposure  NUMERIC(15,2);
BEGIN

  -- Get user from parent transaction
  SELECT t.user_id
    INTO v_user_id
    FROM transactions t
   WHERE t.id = NEW.transaction_id;

  -- Lock ledger row (prevents race condition on concurrent bets)
  SELECT user_limit
    INTO v_user_limit
    FROM ledger_limit
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_user_limit IS NULL THEN
    RETURN NEW;
  END IF;


  -- -------------------------------------------------------
  -- UNIFIED WORST-CASE EXPOSURE (Odds + Sessions)
  --
  -- For each market:
  --   1. Collect all active bets (selected runner row only)
  --   2. Build possible outcomes per market
  --   3. Calculate net P&L if that outcome wins
  --   4. worst_pnl = MIN(pnl) across all outcomes
  --   5. market_exposure = ABS(worst_pnl) if negative, else 0
  -- -------------------------------------------------------

  WITH active_bets AS (
    SELECT
      t.market_id,
      t.market_type,
      td.bet_type,
      td.runner_id          AS selected_runner_id,
      td.stake::NUMERIC     AS stake,
      COALESCE(td.potential_return::NUMERIC, 0) AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = v_user_id
      AND (t.status = 'matched' OR t.id = NEW.transaction_id)
  ),

  -- All possible outcomes per market
  market_outcomes AS (
    -- Odds/Bookmaker: each distinct runner that has a bet
    SELECT DISTINCT market_id, selected_runner_id AS outcome_id
      FROM active_bets
     WHERE market_type <> 2
    UNION
    -- Odds/Bookmaker: synthetic "other" outcome (no bet runner wins)
    SELECT DISTINCT market_id, '__OTHER__' AS outcome_id
      FROM active_bets
     WHERE market_type <> 2
    UNION
    -- Session: runner wins (YES)
    SELECT DISTINCT market_id, selected_runner_id AS outcome_id
      FROM active_bets
     WHERE market_type = 2
    UNION
    -- Session: runner loses (NO)
    SELECT DISTINCT market_id, '__NO__' AS outcome_id
      FROM active_bets
     WHERE market_type = 2
  ),

  -- Net P&L for each (market, outcome) combination
  pnl_calc AS (
    SELECT
      mo.market_id,
      mo.outcome_id,
      SUM(
        CASE ab.bet_type
          WHEN 'back' THEN
            CASE
              WHEN ab.selected_runner_id = mo.outcome_id
                THEN ab.potential_return - ab.stake   -- back wins
              ELSE -ab.stake                           -- back loses
            END
          ELSE -- lay
            CASE
              WHEN ab.selected_runner_id = mo.outcome_id
                THEN ab.stake - ab.potential_return   -- lay loses (liability)
              ELSE ab.stake                            -- lay wins
            END
        END
      ) AS pnl
    FROM market_outcomes mo
    JOIN active_bets ab ON ab.market_id = mo.market_id
    GROUP BY mo.market_id, mo.outcome_id
  ),

  -- Worst-case P&L per market (each market is independent)
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


  -- -------------------------------------------------------
  -- UPDATE LEDGER (no validation — backend already checked)
  -- -------------------------------------------------------

  UPDATE ledger_limit
     SET limit_consumed = v_total_exposure,
         final_limit    = user_limit - v_total_exposure,
         update_date    = NOW()
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
