-- ─────────────────────────────────────────────────────────────────────────────
-- Enforce bet stake and exposure against ledger_limit.final_limit
--
-- Rules:
--   1) A single bet's stake may not exceed the user's current final_limit.
--   2) The additional worst‑case loss introduced by the new bet may not exceed
--      the user's current final_limit.
--
-- This replaces the previous version of trg_recalc_ledger_on_bet while
-- preserving the existing exposure algorithm, but changing the guard
-- condition from user_limit to final_limit and adding a per‑bet stake check.
-- ─────────────────────────────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_bet()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id         UUID;
  v_user_limit      NUMERIC(15,2);
  v_prev_consumed   NUMERIC(15,2);
  v_final_limit     NUMERIC(15,2);
  v_total_exposure  NUMERIC(15,2);
  v_new_loss        NUMERIC(15,2);
BEGIN
  -- Resolve user from the parent transaction
  SELECT t.user_id
    INTO v_user_id
    FROM transactions t
   WHERE t.id = NEW.transaction_id;

  -- Load current ledger state
  SELECT user_limit, limit_consumed, final_limit
    INTO v_user_limit, v_prev_consumed, v_final_limit
    FROM ledger_limit
   WHERE user_id = v_user_id;

  -- No ledger record → nothing to enforce
  IF v_user_limit IS NULL THEN
    RETURN NEW;
  END IF;

  -- If final_limit <= 0, user cannot place any positive‑exposure bet
  IF v_final_limit <= 0 THEN
    RAISE EXCEPTION 'Bet rejected: you have no available limit (final limit %)', v_final_limit;
  END IF;

  -- Rule 1: single bet stake cannot exceed final_limit
  IF NEW.stake::NUMERIC > v_final_limit THEN
    RAISE EXCEPTION 'Bet rejected: stake % exceeds your available limit %',
      NEW.stake::NUMERIC, v_final_limit;
  END IF;

  -- ── P&L exposure calculation (unchanged) ───────────────────────────────────
  WITH
  -- One row per active bet (only the user‑selection detail row)
  active_bets AS (
    SELECT
      t.market_id,
      t.market_type,
      td.bet_type,
      td.stake::NUMERIC            AS stake,
      td.runner_id                 AS selected_runner_id,
      td.potential_return::NUMERIC AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = v_user_id
      AND t.status  = 'matched'
  ),

  -- All possible winning outcomes per market:
  --   • non‑session markets  → every distinct runner_id in the market
  --   • session markets      → selected runner (YES) + synthetic '__NO__'
  market_outcomes AS (
    SELECT DISTINCT t.market_id, td.runner_id AS outcome_id
      FROM transactions t
      JOIN transaction_details td ON td.transaction_id = t.id
     WHERE t.user_id     = v_user_id
       AND t.status       = 'matched'
       AND t.market_type <> 'sessions'
    UNION
    SELECT DISTINCT market_id, selected_runner_id AS outcome_id
      FROM active_bets
     WHERE market_type = 'sessions'
    UNION
    SELECT DISTINCT market_id, '__NO__' AS outcome_id
      FROM active_bets
     WHERE market_type = 'sessions'
  ),

  -- Net P&L for each (market, outcome) combination
  market_pnl AS (
    SELECT
      mo.market_id,
      mo.outcome_id,
      SUM(
        CASE ab.bet_type
          WHEN 'back' THEN
            CASE WHEN ab.selected_runner_id = mo.outcome_id
                 THEN ab.potential_return - ab.stake   -- back: selection wins
                 ELSE -ab.stake                        -- back: selection loses
            END
          ELSE -- lay
            CASE WHEN ab.selected_runner_id = mo.outcome_id
                 THEN ab.stake - ab.potential_return   -- lay: selection wins (user loses)
                 ELSE ab.stake                         -- lay: selection loses (user wins)
            END
        END
      ) AS pnl
    FROM market_outcomes mo
    JOIN active_bets ab ON ab.market_id = mo.market_id
    GROUP BY mo.market_id, mo.outcome_id
  ),

  -- Worst‑case P&L per market
  market_worst AS (
    SELECT market_id, MIN(pnl) AS worst_pnl
      FROM market_pnl
     GROUP BY market_id
  )

  SELECT COALESCE(SUM(ABS(worst_pnl)), 0)
    INTO v_total_exposure
    FROM market_worst
   WHERE worst_pnl < 0;

  -- Additional loss introduced by this bet (vs previous exposure)
  v_new_loss := GREATEST(v_total_exposure - v_prev_consumed, 0);

  -- Rule 2: new worst‑case loss must not exceed remaining final_limit
  IF v_new_loss > v_final_limit THEN
    RAISE EXCEPTION 'Bet rejected: estimated loss % exceeds your available limit %',
      v_new_loss, v_final_limit;
  END IF;

  -- Update ledger: consumed + final limit based on new total exposure
  UPDATE ledger_limit
     SET limit_consumed = v_total_exposure,
         final_limit    = user_limit - v_total_exposure,
         updated_at     = NOW()
   WHERE user_id = v_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind (or re‑bind) the trigger: fires once per bet (on the selected runner row)
DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;

CREATE TRIGGER trg_ledger_limit_on_bet
AFTER INSERT ON transaction_details
FOR EACH ROW
WHEN (NEW.is_user_selection = TRUE)
EXECUTE FUNCTION trg_recalc_ledger_on_bet();

