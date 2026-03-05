
-- ─────────────────────────────────────────────────────────────
-- UPDATE LEDGER EXPOSURE TRIGGER (ODDS + SESSIONS SUPPORTED)
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
  v_odds_exposure   NUMERIC(15,2);
  v_session_exposure NUMERIC(15,2);
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
      'Bet rejected: stake % exceeds available limit %',
      NEW.stake::NUMERIC, v_final_limit;
  END IF;


  -- ─────────────────────────────────────────────
  -- 1️⃣ ODDS MARKET EXPOSURE (Worst case logic)
  -- ─────────────────────────────────────────────

  WITH active_odds AS (
    SELECT
      t.market_id,
      td.bet_type,
      td.runner_id,
      td.stake::NUMERIC AS stake,
      td.potential_return::NUMERIC AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = v_user_id
      AND t.status = 'matched'
      AND t.market_type <> 'sessions'
  ),

  outcome_list AS (
    SELECT DISTINCT market_id, runner_id
    FROM active_odds
  ),

  pnl_calc AS (
    SELECT
      o.market_id,
      o.runner_id,
      SUM(
        CASE a.bet_type
          WHEN 'back' THEN
            CASE
              WHEN a.runner_id = o.runner_id
                THEN a.potential_return - a.stake
              ELSE -a.stake
            END
          ELSE
            CASE
              WHEN a.runner_id = o.runner_id
                THEN a.stake - a.potential_return
              ELSE a.stake
            END
        END
      ) AS pnl
    FROM outcome_list o
    JOIN active_odds a
      ON a.market_id = o.market_id
    GROUP BY o.market_id, o.runner_id
  ),

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


  -- ─────────────────────────────────────────────
  -- 2️⃣ SESSION MARKET EXPOSURE (Simple stake rule)
  -- ─────────────────────────────────────────────
  -- For sessions: exposure = SUM(stake)

  SELECT COALESCE(SUM(td.stake::NUMERIC), 0)
  INTO v_session_exposure
  FROM transactions t
  JOIN transaction_details td
    ON td.transaction_id = t.id
   AND td.is_user_selection = TRUE
  WHERE t.user_id = v_user_id
    AND t.status = 'matched'
    AND t.market_type = 'sessions';


  -- ─────────────────────────────────────────────
  -- FINAL EXPOSURE
  -- ─────────────────────────────────────────────

  v_total_exposure := v_odds_exposure + v_session_exposure;

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