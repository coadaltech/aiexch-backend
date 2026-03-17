-- ---------------------------------------------------------------------------
-- Trigger: Recalculate ledger exposure on bet placement
--
-- Fires AFTER INSERT on transaction_details (for user-selection rows only).
-- Locks the user's ledger_limit row, validates stake <= available limit,
-- then recalculates total exposure:
--   - Odds/Bookmaker: worst-case P&L across all runners per market
--   - Sessions: simple SUM(stake) — each stake is directly deducted
--
-- KEY FIX: Uses (t.status = 'matched' OR t.id = NEW.transaction_id) so the
-- newly inserted bet is ALWAYS included even if its transaction is still
-- in 'pending' status when the trigger fires.
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_bet();

CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_bet()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id          UUID;
  v_user_limit       NUMERIC(15,2);
  v_final_limit      NUMERIC(15,2);
  v_total_exposure   NUMERIC(15,2);
  v_odds_exposure    NUMERIC(15,2);
  v_session_exposure NUMERIC(15,2);
BEGIN

  -- -------------------------------------------------------
  -- STEP 1: Get user and lock ledger row
  -- -------------------------------------------------------

  SELECT t.user_id
    INTO v_user_id
    FROM transactions t
   WHERE t.id = NEW.transaction_id;

  -- Lock ledger row (prevents race condition on concurrent bets)
  SELECT user_limit, final_limit
    INTO v_user_limit, v_final_limit
    FROM ledger_limit
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_user_limit IS NULL THEN
    RAISE EXCEPTION 'Ledger not found for user %', v_user_id;
  END IF;

  IF v_final_limit <= 0 THEN
    RAISE EXCEPTION
      'Bet rejected: no available limit (final limit %)', v_final_limit;
  END IF;

  -- Early reject: stake alone exceeds available limit
  IF NEW.stake::NUMERIC > v_final_limit THEN
    RAISE EXCEPTION
      'Bet rejected: stake % exceeds your available limit %',
      NEW.stake::NUMERIC, v_final_limit;
  END IF;


  -- -------------------------------------------------------
  -- STEP 3: SESSION EXPOSURE — simple SUM of matched stakes
  -- NOTE: uses OR t.id = NEW.transaction_id to include the
  --       current bet even if its status is not yet 'matched'
  -- -------------------------------------------------------

  SELECT COALESCE(SUM(td.stake::NUMERIC), 0)
    INTO v_session_exposure
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
   WHERE t.user_id = v_user_id
     AND (t.status = 'matched' OR t.id = NEW.transaction_id)
     AND t.market_type = 'sessions';


  -- -------------------------------------------------------
  -- STEP 4: ODDS / BOOKMAKER EXPOSURE — worst-case P&L
  --
  -- For each market:
  --   1. Collect all bets for that market
  --   2. Enumerate every runner that has a bet (= possible outcome)
  --   3. Calculate net P&L if that runner wins
  --   4. worst_pnl = MIN(pnl) across all runners
  --   5. market_exposure = ABS(worst_pnl) if negative, else 0
  --
  -- Markets are kept separate (never merged together).
  -- -------------------------------------------------------

  WITH active_odds AS (
    -- All non-session matched bets for this user
    -- Always include the current transaction regardless of its status
    SELECT
      t.market_id,
      td.bet_type,
      td.runner_id,
      td.stake::NUMERIC                    AS stake,
      COALESCE(td.potential_return::NUMERIC, 0) AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = v_user_id
      AND (t.status = 'matched' OR t.id = NEW.transaction_id)
      AND t.market_type <> 'sessions'
  ),

  -- All possible outcomes per market.
  --
  -- We need TWO categories:
  --   1. Each runner that has a bet on it (explicit outcome)
  --   2. '__OTHER__' — represents "a runner with NO bet wins"
  --
  -- Without '__OTHER__', a single back bet on Runner A only sees
  -- the "Runner A wins" (+56) outcome and computes exposure = 0,
  -- completely missing the "Runner A loses" (-100) scenario.
  outcome_list AS (
    -- Runners that have bets (back or lay)
    SELECT DISTINCT market_id, runner_id AS outcome_id
    FROM active_odds
    UNION
    -- Synthetic outcome: a runner with no bet wins
    SELECT DISTINCT market_id, '__OTHER__' AS outcome_id
    FROM active_odds
  ),

  -- Net P&L for each (market, outcome) combination.
  -- '__OTHER__' never matches any runner_id, so it always hits
  -- the ELSE branch: back bets lose their stake, lay bets win their stake.
  pnl_calc AS (
    SELECT
      o.market_id,
      o.outcome_id,
      SUM(
        CASE a.bet_type
          WHEN 'back' THEN
            CASE
              WHEN a.runner_id = o.outcome_id
                THEN a.potential_return - a.stake   -- back wins
              ELSE -a.stake                          -- back loses
            END
          ELSE -- lay
            CASE
              WHEN a.runner_id = o.outcome_id
                THEN a.stake - a.potential_return   -- lay loses (liability)
              ELSE a.stake                           -- lay wins
            END
        END
      ) AS pnl
    FROM outcome_list o
    JOIN active_odds a ON a.market_id = o.market_id
    GROUP BY o.market_id, o.outcome_id
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
  INTO v_odds_exposure
  FROM worst_market;


  -- -------------------------------------------------------
  -- STEP 5: TOTAL EXPOSURE = odds + sessions
  -- -------------------------------------------------------

  v_total_exposure := v_odds_exposure + v_session_exposure;


  -- -------------------------------------------------------
  -- STEP 7: REJECTION RULE
  -- -------------------------------------------------------

  IF v_total_exposure > v_user_limit THEN
    RAISE EXCEPTION
      'Bet rejected: total exposure % exceeds user limit %',
      v_total_exposure, v_user_limit;
  END IF;


  -- -------------------------------------------------------
  -- STEP 6: UPDATE LEDGER
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
