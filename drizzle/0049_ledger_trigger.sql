-- Add limitConsumedAfterDeclare column to ledger_limit
ALTER TABLE "ledger_limit"
  ADD COLUMN "limit_consumed_after_declare" numeric(15, 2) DEFAULT '0' NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: recalculate ledger exposure whenever a bet is placed.
--
-- Fires AFTER INSERT on transaction_details FOR EACH ROW
-- WHEN the inserted row is the user's selection (is_user_selection = TRUE).
--
-- Ordering guarantee: betting.ts always inserts non-selected runner rows first
-- and the selected runner row last, so all sibling rows are already visible
-- when this trigger executes.
--
-- Exposure algorithm:
--   1. Collect all active (status='matched') bets for the user.
--   2. For every (market, possible_outcome) pair compute the net P&L the user
--      would realise if that outcome wins.
--   3. Find the worst-case (minimum) P&L per market.
--   4. Total exposure = sum of absolute worst-case losses across markets.
--   5. If exposure > user_limit  → RAISE EXCEPTION (aborts the transaction).
--   6. Otherwise update limitConsumed and finalLimit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_bet()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id        UUID;
  v_user_limit     NUMERIC(15,2);
  v_total_exposure NUMERIC(15,2);
BEGIN
  -- Resolve user from the parent transaction
  SELECT t.user_id
    INTO v_user_id
    FROM transactions t
   WHERE t.id = NEW.transaction_id;

  -- Load user's assigned credit limit
  SELECT user_limit
    INTO v_user_limit
    FROM ledger_limit
   WHERE user_id = v_user_id;

  -- No ledger record or limit = 0 means unrestricted — skip enforcement
  IF v_user_limit IS NULL OR v_user_limit = 0 THEN
    RETURN NEW;
  END IF;

  -- ── P&L exposure calculation ──────────────────────────────────────────────
  WITH
  -- One row per active bet (only the user-selection detail row)
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
  --   • non-session markets  → every distinct runner_id in the market
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

  -- Worst-case P&L per market
  market_worst AS (
    SELECT market_id, MIN(pnl) AS worst_pnl
      FROM market_pnl
     GROUP BY market_id
  )

  SELECT COALESCE(SUM(ABS(worst_pnl)), 0)
    INTO v_total_exposure
    FROM market_worst
   WHERE worst_pnl < 0;

  -- Block bet if it would push exposure over the limit
  IF v_total_exposure > v_user_limit THEN
    RAISE EXCEPTION 'Bet rejected: estimated loss % exceeds your available limit %',
      v_total_exposure, v_user_limit;
  END IF;

  -- Update ledger: consumed + final limit
  UPDATE ledger_limit
     SET limit_consumed = v_total_exposure,
         final_limit    = user_limit - v_total_exposure,
         updated_at     = NOW()
   WHERE user_id = v_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind the trigger — fires once per bet (on the selected-runner detail row)
DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;

CREATE TRIGGER trg_ledger_limit_on_bet
AFTER INSERT ON transaction_details
FOR EACH ROW
WHEN (NEW.is_user_selection = TRUE)
EXECUTE FUNCTION trg_recalc_ledger_on_bet();
